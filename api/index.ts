import { generateText, jsonSchema, stepCountIs, streamText } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { waitUntil } from "@vercel/functions";
import { CHAT_MODEL_CONFIGS, CHAT_SUPPORT_CONTACT, getChatModelConfig } from "../src/shared/chat-models.js";
import { onboardUser } from "./_lib/onboarding.js";
import { ensureAdmin, ensureAdminOrBootstrap, getSupabaseAdmin, getUserFromRequest, json } from "./_lib/server.js";
import { writeAdminAuditLog } from "./_lib/audit.js";
import { decryptMcpToken, encryptMcpToken } from "./_lib/crypto.js";
import { logError, logWarn } from "./_lib/logger.js";
import { getSystemPrompt } from "./_lib/system-prompt.js";
import { continueCouncilDeliberation, createCouncilDeliberation } from "./_lib/council/handler.js";
import { parseCouncilCreateRequest, parseCouncilFollowUpRequest, parseCouncilInferScopeRequest } from "./_lib/council/schemas.js";
import type { CouncilDeliberation, CouncilResolvedGeography, CouncilScope } from "./_lib/council/types.js";

const CONVERSATION_SELECT_FIELDS = "id,title,starred,is_public,share_token,created_at,updated_at";
const SHARED_CONVERSATION_SELECT_FIELDS = "id,title,created_at,updated_at,is_public,share_token,share_expires_at";

function pathParts(request: Request) {
  const pathname = new URL(request.url).pathname;
  return pathname.split("/").filter(Boolean);
}

function routeParts(request: Request) {
  const url = new URL(request.url);
  const route = url.searchParams.get("route")?.trim();
  if (route) return route.split("/").filter(Boolean);

  const parts = pathParts(request);
  if (parts[0] !== "api") return [];
  return parts.slice(1);
}

function getConversationId(request: Request) {
  const parts = routeParts(request);
  if (parts[0] !== "conversations") return "";
  return parts[1] ?? "";
}

function getSharedToken(request: Request) {
  const parts = routeParts(request);
  if (parts[0] !== "shared") return "";
  return parts[1] ?? "";
}

function env(key: string): string | undefined {
  const maybeProcess = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return maybeProcess.process?.env?.[key];
}

const PRIVACY_NOTICE_VERSION = "2026-03-30";
const DEFAULT_SHARE_EXPIRY_DAYS = 30;
const DEFAULT_RETENTION_DAYS = 365;

const openrouter = createOpenRouter({
  apiKey: env("OPENROUTER_API_KEY"),
});

const AUTO_CHAT_TITLE_MAX_LENGTH = 72;
const AUTO_CHAT_TITLE_DEFAULT_REGEX = /^(new chat(?:\s+\d+)?|untitled)$/i;
const AUTO_CHAT_TITLE_MODEL = "google/gemini-2.5-flash-lite";
const UK_POSTCODE_REGEX = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

function getOpenRouterFallbackModels(modelId: string): string[] {
  switch (modelId) {
    case "flash":
      return ["google/gemini-2.5-flash-lite", "google/gemini-2.5-flash"];
    case "pro":
      return ["google/gemini-2.5-pro", "google/gemini-2.5-flash"];
    default:
      return [];
  }
}

function isProviderInvalidRequestError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as {
    statusCode?: number;
    cause?: { statusCode?: number; responseBody?: unknown; message?: string };
    message?: string;
  };
  if (maybeError.statusCode === 400 || maybeError.cause?.statusCode === 400) return true;
  const responseBody = maybeError.cause?.responseBody;
  if (responseBody && typeof responseBody === "object") {
    const errorType = (responseBody as { metadata?: { error_type?: string } }).metadata?.error_type;
    if (errorType === "invalid_request") return true;
  }
  const message = `${maybeError.message ?? ""} ${maybeError.cause?.message ?? ""}`.toLowerCase();
  return message.includes("invalid_request");
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function parseHttpUrl(value: string | undefined | null): URL | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

function getAuthRedirectBase(request: Request): string {
  const requestUrl = new URL(request.url);
  const configuredAppUrl = parseHttpUrl(env("APP_URL")?.trim());
  const originHeader = parseHttpUrl(request.headers.get("origin"));
  const refererHeader = parseHttpUrl(request.headers.get("referer"));
  const browserOrigin = originHeader ?? refererHeader;

  if (isLoopbackHostname(requestUrl.hostname)) {
    // Dev API runs on :3000 behind the Vite app on :5173; prefer browser origin.
    if (browserOrigin && isLoopbackHostname(browserOrigin.hostname)) return browserOrigin.origin;
    if (configuredAppUrl && isLoopbackHostname(configuredAppUrl.hostname)) return configuredAppUrl.origin;
    return "http://localhost:5173";
  }

  return configuredAppUrl?.origin ?? requestUrl.origin;
}

type PersistedMessagePart = { type: string; [key: string]: unknown };
type PersistedDocumentPart = {
  type: "document";
  documentId: string;
  name: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  extractedText: string;
  pageCount?: number;
  sheetNames?: string[];
};
type McpTransportType = "sse" | "http";
type McpCandidate = { type: McpTransportType; url: string };
type McpAttempt = { type: McpTransportType; url: string; error: string };
type ToolCatalogItem = {
  name: string;
  description: string;
  category: "data" | "analysis" | "system";
  score: number;
  recommended: boolean;
};
type IncomingChatDocument = {
  id?: unknown;
  name?: unknown;
  extension?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  extractedText?: unknown;
  pageCount?: unknown;
  sheetNames?: unknown;
};

const MAX_CHAT_DOCUMENT_COUNT = 8;
const MAX_CHAT_DOCUMENT_TEXT_CHARS = 30_000;
const MAX_CHAT_DOCUMENT_CONTEXT_CHARS = 90_000;

function coerceString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sanitizeIncomingDocuments(input: unknown): PersistedDocumentPart[] {
  if (!Array.isArray(input)) return [];
  const sanitized: PersistedDocumentPart[] = [];
  for (const raw of input.slice(0, MAX_CHAT_DOCUMENT_COUNT)) {
    if (!isRecord(raw)) continue;
    const candidate = raw as IncomingChatDocument;
    const name = coerceString(candidate.name).trim();
    const extractedText = coerceString(candidate.extractedText).trim().slice(0, MAX_CHAT_DOCUMENT_TEXT_CHARS);
    if (!name || !extractedText) continue;
    const extension = coerceString(candidate.extension).trim().toLowerCase();
    const mimeType = coerceString(candidate.mimeType).trim().toLowerCase() || "application/octet-stream";
    const sizeBytes = typeof candidate.sizeBytes === "number" && Number.isFinite(candidate.sizeBytes) ? Math.max(0, candidate.sizeBytes) : 0;
    const documentId = coerceString(candidate.id).trim() || `${name}-${sizeBytes}`;
    const pageCount = typeof candidate.pageCount === "number" && Number.isFinite(candidate.pageCount) ? candidate.pageCount : undefined;
    const sheetNames = Array.isArray(candidate.sheetNames)
      ? candidate.sheetNames.filter((sheet): sheet is string => typeof sheet === "string").slice(0, 20)
      : undefined;
    sanitized.push({
      type: "document",
      documentId,
      name: name.slice(0, 180),
      extension: extension.slice(0, 24),
      mimeType: mimeType.slice(0, 120),
      sizeBytes,
      extractedText,
      pageCount,
      sheetNames,
    });
  }
  return sanitized;
}

function buildDocumentContextFromParts(parts: PersistedMessagePart[]): string {
  const documentParts = parts.filter((part): part is PersistedDocumentPart => part.type === "document");
  if (documentParts.length === 0) return "";
  let remainingChars = MAX_CHAT_DOCUMENT_CONTEXT_CHARS;
  const snippets: string[] = [];
  for (const doc of documentParts) {
    if (remainingChars <= 0) break;
    const snippet = doc.extractedText.slice(0, Math.min(remainingChars, MAX_CHAT_DOCUMENT_TEXT_CHARS));
    if (!snippet.trim()) continue;
    const header = `Document: ${doc.name}${doc.extension ? ` (.${doc.extension})` : ""}`;
    const body = `${header}\n${snippet}`;
    snippets.push(body);
    remainingChars -= body.length;
  }
  if (snippets.length === 0) return "";
  return [
    "DOCUMENT CONTEXT",
    "The following user-uploaded document excerpts are part of this conversation context.",
    "Use them when answering, and cite assumptions if excerpts are incomplete.",
    "",
    snippets.join("\n\n---\n\n"),
  ].join("\n");
}

async function loadConversationDocumentContext({
  supabase,
  conversationId,
}: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  conversationId: string;
}): Promise<string> {
  const { data: messages, error } = await supabase
    .from("uk_chat_messages")
    .select("parts")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .order("created_at", { ascending: true });
  if (error || !messages) return "";

  const allDocumentParts: PersistedMessagePart[] = [];
  for (const message of messages) {
    const parts = Array.isArray(message.parts) ? message.parts : [];
    for (const part of parts) {
      if (!isRecord(part) || part.type !== "document") continue;
      allDocumentParts.push(part as PersistedMessagePart);
    }
  }
  return buildDocumentContextFromParts(allDocumentParts);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSchemaWrapper(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return "validate" in value || "jsonSchema" in value || "~standard" in value;
}

const MAX_TOOL_OUTPUT_DEPTH = 5;
const MAX_TOOL_OUTPUT_STRING = 8_000;
const MAX_TOOL_OUTPUT_ARRAY_ITEMS = 180;
const MAX_TOOL_OUTPUT_OBJECT_KEYS = 60;

function compactToolOutputForModel(value: unknown, depth = 0): unknown {
  if (depth > MAX_TOOL_OUTPUT_DEPTH) return "[truncated: depth]";

  if (typeof value === "string") {
    if (value.length <= MAX_TOOL_OUTPUT_STRING) return value;
    return `${value.slice(0, MAX_TOOL_OUTPUT_STRING)}\n\n[truncated for model context]`;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;

  if (Array.isArray(value)) {
    const compacted = value.slice(0, MAX_TOOL_OUTPUT_ARRAY_ITEMS).map((item) => compactToolOutputForModel(item, depth + 1));
    if (value.length > MAX_TOOL_OUTPUT_ARRAY_ITEMS) {
      compacted.push(`[truncated: ${value.length - MAX_TOOL_OUTPUT_ARRAY_ITEMS} more items]`);
    }
    return compacted;
  }

  if (!isRecord(value)) return value;

  const entries = Object.entries(value);
  const compactedObject: Record<string, unknown> = {};
  for (const [index, [key, entry]] of entries.entries()) {
    if (index >= MAX_TOOL_OUTPUT_OBJECT_KEYS) {
      compactedObject.__truncated__ = `${entries.length - MAX_TOOL_OUTPUT_OBJECT_KEYS} more keys omitted`;
      break;
    }
    compactedObject[key] = compactToolOutputForModel(entry, depth + 1);
  }
  return compactedObject;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildMcpCandidates(configuredUrl: string): McpCandidate[] {
  const raw = configuredUrl.trim();
  const url = parseHttpUrl(raw);
  if (!url) {
    return [{ type: "sse", url: raw }];
  }

  const root = new URL(url.toString());
  root.pathname = root.pathname.replace(/\/+$/, "");
  const rootUrl = root.toString();
  const path = root.pathname;
  const looksLikeSse = /\/sse$/i.test(path);
  const looksLikeMcp = /\/mcp$/i.test(path);

  const candidates: McpCandidate[] = [];
  const seen = new Set<string>();
  const add = (type: McpTransportType, candidateUrl: string) => {
    const key = `${type}:${candidateUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ type, url: candidateUrl });
  };

  add("sse", url.toString());
  add("http", url.toString());

  if (looksLikeSse) {
    const base = url.toString().replace(/\/sse\/?$/i, "");
    add("http", `${base}/mcp`);
    add("http", base);
  } else if (looksLikeMcp) {
    const base = url.toString().replace(/\/mcp\/?$/i, "");
    add("sse", `${base}/sse`);
    add("sse", base);
  } else {
    add("sse", `${rootUrl}/sse`);
    add("http", `${rootUrl}/mcp`);
    add("http", rootUrl);
  }

  return candidates;
}

async function loadMcpToolsWithFallback(configuredUrl: string, token: string) {
  const candidates = buildMcpCandidates(configuredUrl);
  const attempts: McpAttempt[] = [];

  for (const candidate of candidates) {
    try {
      const mcpClient = await createMCPClient({
        transport: {
          type: candidate.type,
          url: candidate.url,
          headers: { Authorization: `Bearer ${token}` },
        },
      });
      const tools = await mcpClient.tools();
      return { tools, connectedVia: candidate, attempts };
    } catch (error) {
      attempts.push({
        type: candidate.type,
        url: candidate.url,
        error: errorMessage(error),
      });
    }
  }

  return { tools: null, connectedVia: null, attempts };
}

function compactMcpToolsForModelContext(tools: Record<string, unknown>): Record<string, unknown> {
  const compactedEntries = Object.entries(tools).map(([toolName, definition]) => {
    if (!isRecord(definition) || typeof definition.execute !== "function") return [toolName, definition] as const;

    const originalExecute = definition.execute as (...args: unknown[]) => unknown;
    const wrappedDefinition = {
      ...definition,
      execute: async (...args: unknown[]) => {
        const result = await originalExecute(...args);
        return compactToolOutputForModel(result);
      },
    };
    return [toolName, wrappedDefinition] as const;
  });

  return Object.fromEntries(compactedEntries);
}

function isMcpUnauthorized(attempts: McpAttempt[]): boolean {
  return attempts.some((attempt) => {
    const message = attempt.error.toLowerCase();
    return message.includes("401") || message.includes("unauthorized");
  });
}

function inferArrayItemsFromPath(path: string[]): Record<string, unknown> {
  const key = path[path.length - 1]?.toLowerCase() ?? "";
  if (key === "bbox") return { type: "number" };
  if (key.includes("record")) return { type: "object", additionalProperties: true };
  return { type: "string" };
}

function inferTupleItemsSchema(items: unknown[]): Record<string, unknown> {
  const schemaTypes = items
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => item.type)
    .filter((value): value is string => typeof value === "string");
  if (schemaTypes.length === 0) return { type: "string" };
  if (schemaTypes.every((kind) => kind === "integer" || kind === "number")) return { type: "number" };
  if (schemaTypes.every((kind) => kind === "string")) return { type: "string" };
  return { type: "string" };
}

function normalizeToolSchemaInPlace(node: unknown, path: string[] = []): boolean {
  let changed = false;

  if (Array.isArray(node)) {
    for (const item of node) {
      if (normalizeToolSchemaInPlace(item, path)) changed = true;
    }
    return changed;
  }
  if (!isRecord(node)) return false;

  for (const unionKey of ["anyOf", "oneOf", "allOf"] as const) {
    const unionValue = node[unionKey];
    if (!Array.isArray(unionValue) || unionValue.length === 0) continue;
    const preferred = unionValue.find((entry) => isRecord(entry)) ?? unionValue[0];
    if (isRecord(preferred)) {
      for (const [key, value] of Object.entries(preferred)) {
        if (node[key] === undefined) node[key] = value;
      }
    }
    delete node[unionKey];
    changed = true;
  }

  if (Array.isArray(node.prefixItems)) {
    if (node.items === undefined) {
      node.items = inferTupleItemsSchema(node.prefixItems);
    }
    delete node.prefixItems;
    changed = true;
  }

  if (Array.isArray(node.items)) {
    node.items = inferTupleItemsSchema(node.items);
    changed = true;
  }
  if (node.type === "array" && !isRecord(node.items)) {
    node.items = inferArrayItemsFromPath(path);
    changed = true;
  }

  for (const [key, value] of Object.entries(node)) {
    if (normalizeToolSchemaInPlace(value, [...path, key])) changed = true;
  }

  return changed;
}

function normalizeToolSchemas<T extends Record<string, unknown>>(tools: T): {
  normalizedTools: T;
  normalizedToolNames: string[];
} {
  const entries: Array<[string, unknown]> = [];
  const normalizedToolNames: string[] = [];

  for (const [toolName, toolDefinition] of Object.entries(tools)) {
    if (!isRecord(toolDefinition)) {
      entries.push([toolName, toolDefinition]);
      continue;
    }
    const schemaKey = isRecord(toolDefinition.parameters)
      ? "parameters"
      : isRecord(toolDefinition.inputSchema)
        ? "inputSchema"
        : null;
    if (!schemaKey) {
      entries.push([toolName, toolDefinition]);
      continue;
    }

    const schemaValue = toolDefinition[schemaKey];
    const isInputSchemaWrapper = schemaKey === "inputSchema" && isSchemaWrapper(schemaValue);
    const toolCopy: Record<string, unknown> = { ...toolDefinition };

    if (isInputSchemaWrapper) {
      const wrapper = schemaValue as Record<string, unknown>;
      let rawSchema: unknown = wrapper.jsonSchema;
      try {
        rawSchema = structuredClone(rawSchema);
      } catch {
        // Keep original schema object if clone fails.
      }
      const changed = normalizeToolSchemaInPlace(rawSchema, [toolName, schemaKey, "jsonSchema"]);
      if (changed) {
        const validate = typeof wrapper.validate === "function" ? (wrapper.validate as (value: unknown) => unknown) : undefined;
        toolCopy[schemaKey] = jsonSchema(
          rawSchema as Record<string, unknown>,
          validate ? { validate: validate as never } : undefined,
        );
        normalizedToolNames.push(toolName);
      } else {
        toolCopy[schemaKey] = schemaValue;
      }
      entries.push([toolName, toolCopy]);
      continue;
    }

    let schemaCopy: unknown = schemaValue;
    try {
      schemaCopy = structuredClone(schemaValue);
    } catch {
      // Keep original schema object if clone fails.
    }
    const changed = normalizeToolSchemaInPlace(schemaCopy, [toolName, schemaKey]);
    toolCopy[schemaKey] = schemaCopy;
    if (changed) normalizedToolNames.push(toolName);
    entries.push([toolName, toolCopy]);
  }

  return { normalizedTools: Object.fromEntries(entries) as T, normalizedToolNames };
}

type ToolSchemaProjectionRule = {
  toolNames: string[];
  removeProperties: string[];
  removeKindEnumValues?: string[];
};

const WEAK_MODEL_TOOL_SCHEMA_PROJECTION_RULES: ToolSchemaProjectionRule[] = [
  {
    toolNames: ["parliament.fetchHansard", "parliament_fetchHansard"],
    removeProperties: ["baseUrl"],
  },
  {
    toolNames: ["osm.assets", "osm_assets"],
    removeProperties: ["endpoint"],
  },
  {
    toolNames: ["desnz.fetchCo2", "desnz_fetchCo2"],
    removeProperties: ["url"],
    removeKindEnumValues: ["custom_csv"],
  },
  {
    toolNames: ["finance.laRevenue", "finance_laRevenue"],
    removeProperties: ["url"],
    removeKindEnumValues: ["custom_csv"],
  },
];

function projectToolSchemaForRule(schema: unknown, rule: ToolSchemaProjectionRule): boolean {
  if (!isRecord(schema)) return false;

  let changed = false;
  const schemaProperties = isRecord(schema.properties) ? (schema.properties as Record<string, unknown>) : null;

  if (schemaProperties) {
    for (const propertyName of rule.removeProperties) {
      if (propertyName in schemaProperties) {
        delete schemaProperties[propertyName];
        changed = true;
      }
    }
  }

  const required = Array.isArray(schema.required) ? schema.required : null;
  if (required) {
    const filteredRequired = required.filter(
      (entry): entry is string => typeof entry === "string" && !rule.removeProperties.includes(entry),
    );
    if (filteredRequired.length !== required.length) {
      schema.required = filteredRequired;
      changed = true;
    }
  }

  if (rule.removeKindEnumValues && schemaProperties && isRecord(schemaProperties.kind)) {
    const removeKindEnumValues = rule.removeKindEnumValues;
    const kindSchema = schemaProperties.kind as Record<string, unknown>;
    const enumValues = Array.isArray(kindSchema.enum) ? kindSchema.enum : null;
    if (enumValues) {
      const filteredEnumValues = enumValues.filter(
        (entry): entry is string => typeof entry === "string" && !removeKindEnumValues.includes(entry),
      );
      if (filteredEnumValues.length !== enumValues.length) {
        kindSchema.enum = filteredEnumValues;
        changed = true;
      }
      if (typeof kindSchema.default === "string" && removeKindEnumValues.includes(kindSchema.default)) {
        const fallbackDefault = filteredEnumValues.find((entry) => typeof entry === "string");
        if (fallbackDefault !== undefined) {
          kindSchema.default = fallbackDefault;
        } else {
          delete kindSchema.default;
        }
        changed = true;
      }
    }
  }

  return changed;
}

const MODELS_NEEDING_SCHEMA_PROJECTION = new Set<string>([
  // Sonnet 4.6 does NOT need projection — strong tool-calling model.
  // Add "sonnet" here only if the slot is reassigned to a weaker model.
]);

function projectToolSchemasForModel<T extends Record<string, unknown>>(
  tools: T,
  modelId: string,
): { projectedTools: T; projectedToolNames: string[] } {
  if (!MODELS_NEEDING_SCHEMA_PROJECTION.has(modelId)) {
    return { projectedTools: tools, projectedToolNames: [] };
  }

  const rulesByToolName = new Map<string, ToolSchemaProjectionRule>();
  for (const rule of WEAK_MODEL_TOOL_SCHEMA_PROJECTION_RULES) {
    for (const toolName of rule.toolNames) rulesByToolName.set(toolName, rule);
  }

  const entries: Array<[string, unknown]> = [];
  const projectedToolNames: string[] = [];

  for (const [toolName, toolDefinition] of Object.entries(tools)) {
    const rule = rulesByToolName.get(toolName);
    if (!rule || !isRecord(toolDefinition)) {
      entries.push([toolName, toolDefinition]);
      continue;
    }

    const schemaKey = isRecord(toolDefinition.parameters)
      ? "parameters"
      : isRecord(toolDefinition.inputSchema)
        ? "inputSchema"
        : null;
    if (!schemaKey) {
      entries.push([toolName, toolDefinition]);
      continue;
    }

    const schemaValue = toolDefinition[schemaKey];
    const toolCopy: Record<string, unknown> = { ...toolDefinition };
    const isInputSchemaWrapper = schemaKey === "inputSchema" && isSchemaWrapper(schemaValue);

    if (isInputSchemaWrapper && isRecord(schemaValue)) {
      const wrapper = schemaValue as Record<string, unknown>;
      let rawSchema: unknown = wrapper.jsonSchema;
      try {
        rawSchema = structuredClone(rawSchema);
      } catch {
        // Keep original schema object if clone fails.
      }
      const changed = projectToolSchemaForRule(rawSchema, rule);
      if (changed) {
        const validate = typeof wrapper.validate === "function" ? (wrapper.validate as (value: unknown) => unknown) : undefined;
        toolCopy[schemaKey] = jsonSchema(
          rawSchema as Record<string, unknown>,
          validate ? { validate: validate as never } : undefined,
        );
        projectedToolNames.push(toolName);
      } else {
        toolCopy[schemaKey] = schemaValue;
      }
      entries.push([toolName, toolCopy]);
      continue;
    }

    let schemaCopy: unknown = schemaValue;
    try {
      schemaCopy = structuredClone(schemaValue);
    } catch {
      // Keep original schema object if clone fails.
    }
    const changed = projectToolSchemaForRule(schemaCopy, rule);
    if (changed) {
      projectedToolNames.push(toolName);
    }
    toolCopy[schemaKey] = schemaCopy;
    entries.push([toolName, toolCopy]);
  }

  return { projectedTools: Object.fromEntries(entries) as T, projectedToolNames };
}

const PROVIDER_TOOL_NAME_MAX_LENGTH = 128;
const PROVIDER_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_MODEL_CONTEXT_MESSAGES = 12;
const MAX_MODEL_MESSAGE_PARTS = 10;
const MAX_MODEL_TEXT_PART_CHARS = 4_000;
type CompactModelMessage = { role: "user" | "assistant" | "system"; content: string };
const CREATE_CHART_TOOL_NAME = "create_chart";

const CREATE_CHART_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["type", "title", "xField", "yFields", "data"],
  properties: {
    type: { type: "string", enum: ["line", "bar", "scatter", "area", "pie", "table"] },
    title: { type: "string" },
    xField: { type: "string" },
    yFields: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
    labelField: { type: "string" },
    groupField: { type: "string" },
    data: {
      type: "array",
      maxItems: 160,
      items: {
        type: "object",
        additionalProperties: true,
      },
    },
    sources: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
};

const MAX_CREATE_CHART_ROWS = 120;
const MAX_CREATE_CHART_COLUMNS = 14;
const MAX_CREATE_CHART_STRING_LENGTH = 220;

function parseJsonSafely(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function unwrapQuotedField(value: string): string {
  let current = value.trim();
  for (let index = 0; index < 3; index += 1) {
    if (current.length < 2) break;
    const first = current[0];
    const last = current[current.length - 1];
    const wrapped =
      (first === '"' && last === '"') || (first === "'" && last === "'") || (first === "`" && last === "`");
    if (!wrapped) break;
    current = current.slice(1, -1).trim();
  }
  return current;
}

function normalizeChartFieldList(value: unknown, maxItems: number): string[] {
  const parsed = typeof value === "string" ? parseJsonSafely(value) : value;
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => (typeof item === "string" ? unwrapQuotedField(item) : ""))
      .filter((item) => item.length > 0)
      .slice(0, maxItems);
  }
  if (typeof parsed === "string") {
    const normalized = unwrapQuotedField(parsed);
    return normalized ? [normalized] : [];
  }
  return [];
}

function normalizeChartDataRows(value: unknown): Array<Record<string, unknown>> {
  const parsed = typeof value === "string" ? parseJsonSafely(value) : value;
  if (!Array.isArray(parsed)) return [];

  const rows: Array<Record<string, unknown>> = [];
  for (const row of parsed) {
    const candidate = typeof row === "string" ? parseJsonSafely(row) : row;
    if (!isRecord(candidate)) continue;
    const normalizedRow: Record<string, unknown> = {};
    for (const [key, cell] of Object.entries(candidate)) {
      normalizedRow[unwrapQuotedField(key)] = cell;
    }
    rows.push(normalizedRow);
  }
  return rows;
}

function normalizeCreateChartSpec(input: unknown): unknown {
  if (!isRecord(input)) return input;

  const normalizedData = normalizeChartDataRows(input.data);
  const normalizedYFields = normalizeChartFieldList(input.yFields, 6);
  const normalizedSources = normalizeChartFieldList(input.sources, 8);

  const xField = typeof input.xField === "string" ? unwrapQuotedField(input.xField) : input.xField;
  const labelField = typeof input.labelField === "string" ? unwrapQuotedField(input.labelField) : input.labelField;
  const groupField = typeof input.groupField === "string" ? unwrapQuotedField(input.groupField) : input.groupField;

  return {
    ...input,
    xField,
    labelField,
    groupField,
    data: normalizedData.length > 0 ? normalizedData : input.data,
    yFields: normalizedYFields.length > 0 ? normalizedYFields : input.yFields,
    sources: normalizedSources.length > 0 ? normalizedSources : input.sources,
  };
}

function compactCreateChartSpec(input: unknown): unknown {
  const normalizedInput = normalizeCreateChartSpec(input);
  if (!isRecord(normalizedInput)) return normalizedInput;

  const compactedData = Array.isArray(normalizedInput.data)
    ? normalizedInput.data
        .slice(0, MAX_CREATE_CHART_ROWS)
        .map((row) => {
          if (!isRecord(row)) return row;
          const compactedRow: Record<string, unknown> = {};
          for (const [index, [key, value]] of Object.entries(row).entries()) {
            if (index >= MAX_CREATE_CHART_COLUMNS) break;
            if (typeof value === "string" && value.length > MAX_CREATE_CHART_STRING_LENGTH) {
              compactedRow[key] = `${value.slice(0, MAX_CREATE_CHART_STRING_LENGTH)}...`;
            } else {
              compactedRow[key] = value;
            }
          }
          return compactedRow;
        })
    : normalizedInput.data;

  const yFields = Array.isArray(normalizedInput.yFields)
    ? normalizedInput.yFields.filter((item): item is string => typeof item === "string").slice(0, 6)
    : normalizedInput.yFields;
  const sources = Array.isArray(normalizedInput.sources)
    ? normalizedInput.sources.filter((item): item is string => typeof item === "string").slice(0, 8)
    : normalizedInput.sources;

  return {
    ...normalizedInput,
    data: compactedData,
    yFields,
    sources,
  };
}

function toProviderSafeToolName(name: string): string {
  const normalized = name.trim().replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");
  const fallback = normalized || "tool";
  return fallback.slice(0, PROVIDER_TOOL_NAME_MAX_LENGTH);
}

function buildProviderSafeTools<T extends Record<string, unknown>>(tools: T): {
  safeTools: T;
  safeToOriginal: Map<string, string>;
  renamedPairs: Array<{ original: string; safe: string }>;
} {
  const safeToOriginal = new Map<string, string>();
  const renamedPairs: Array<{ original: string; safe: string }> = [];
  const entries: Array<[string, unknown]> = [];
  const usedNames = new Set<string>();

  for (const [originalName, definition] of Object.entries(tools)) {
    let safeName = PROVIDER_TOOL_NAME_PATTERN.test(originalName) ? originalName : toProviderSafeToolName(originalName);
    let suffix = 2;
    while (usedNames.has(safeName) || !PROVIDER_TOOL_NAME_PATTERN.test(safeName)) {
      const suffixText = `_${suffix}`;
      const baseLength = Math.max(1, PROVIDER_TOOL_NAME_MAX_LENGTH - suffixText.length);
      safeName = `${toProviderSafeToolName(originalName).slice(0, baseLength)}${suffixText}`;
      suffix += 1;
    }
    usedNames.add(safeName);
    safeToOriginal.set(safeName, originalName);
    if (safeName !== originalName) renamedPairs.push({ original: originalName, safe: safeName });
    entries.push([safeName, definition]);
  }

  return {
    safeTools: Object.fromEntries(entries) as T,
    safeToOriginal,
    renamedPairs,
  };
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated for context window]`;
}

function compactMessagesForModel(messages: unknown): CompactModelMessage[] {
  if (!Array.isArray(messages)) return [];

  const compacted: CompactModelMessage[] = [];
  for (const message of messages.slice(-MAX_MODEL_CONTEXT_MESSAGES)) {
    if (!isRecord(message)) continue;
    const role = message.role === "assistant" || message.role === "system" ? message.role : "user";
    const rawParts = Array.isArray(message.parts) ? message.parts : [];
    const textChunks: string[] = [];

    for (const part of rawParts.slice(0, MAX_MODEL_MESSAGE_PARTS)) {
      if (!isRecord(part) || typeof part.type !== "string") continue;
      if (part.type === "text" && typeof part.text === "string") {
        textChunks.push(truncateText(part.text, MAX_MODEL_TEXT_PART_CHARS));
        continue;
      }
      // Exclude heavy reasoning/tool payloads from replay context.
      if (part.type === "reasoning" || part.type.startsWith("tool-")) continue;
    }

    if (textChunks.length === 0 && typeof message.content === "string" && message.content.trim()) {
      textChunks.push(truncateText(message.content, MAX_MODEL_TEXT_PART_CHARS));
    }

    const content = textChunks.join("\n\n").trim();
    if (!content) continue;
    compacted.push({ role, content });
  }

  return compacted;
}

function sanitizeToolName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const normalized = name.trim();
  if (!normalized) return null;
  return normalized.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function createShareToken() {
  return `share_${crypto.randomUUID().replace(/-/g, "")}`;
}

function buildShareExpiryIso(days = DEFAULT_SHARE_EXPIRY_DAYS): string {
  const millis = Math.max(1, days) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + millis).toISOString();
}

function extractPartsFromResponseMessage(
  message: unknown,
  resolveToolName?: (name: string) => string,
): PersistedMessagePart[] {
  if (!isRecord(message)) return [];

  const directParts = message.parts;
  if (Array.isArray(directParts)) {
    return directParts.filter((part): part is PersistedMessagePart => isRecord(part) && typeof part.type === "string");
  }

  const content = message.content;
  if (!Array.isArray(content)) return [];

  const toolIndex = new Map<string, PersistedMessagePart>();
  const parts: PersistedMessagePart[] = [];

  for (const segment of content) {
    if (!isRecord(segment) || typeof segment.type !== "string") continue;

    if (segment.type === "text" && typeof segment.text === "string") {
      parts.push({ type: "text", text: segment.text });
      continue;
    }

    if (segment.type === "reasoning" && typeof segment.text === "string") {
      parts.push({ type: "reasoning", text: segment.text });
      continue;
    }

    if (segment.type === "tool-call") {
      const resolvedName = typeof segment.toolName === "string" ? resolveToolName?.(segment.toolName) ?? segment.toolName : segment.toolName;
      const toolName = sanitizeToolName(resolvedName);
      if (!toolName) continue;
      const callId = (segment.toolCallId as string) ?? null;
      const part: PersistedMessagePart = {
        type: `tool-${toolName}`,
        state: "input-available",
        input: segment.input ?? null,
        toolCallId: callId,
      };
      parts.push(part);
      if (callId) toolIndex.set(callId, part);
      continue;
    }

    if (segment.type === "tool-result") {
      const resolvedName = typeof segment.toolName === "string" ? resolveToolName?.(segment.toolName) ?? segment.toolName : segment.toolName;
      const toolName = sanitizeToolName(resolvedName);
      if (!toolName) continue;
      const callId = (segment.toolCallId as string) ?? null;
      const existing = callId ? toolIndex.get(callId) : undefined;
      if (existing) {
        existing.state = "output-available";
        existing.output = segment.output ?? null;
      } else {
        parts.push({
          type: `tool-${toolName}`,
          state: "output-available",
          output: segment.output ?? null,
          toolCallId: callId,
        });
      }
      continue;
    }

    parts.push(segment as PersistedMessagePart);
  }
  return parts;
}

function mergeToolCallsAndResultsIntoParts(
  parts: PersistedMessagePart[],
  event: unknown,
  resolveToolName?: (name: string) => string,
): PersistedMessagePart[] {
  if (!isRecord(event)) return parts;

  const merged = [...parts];
  const toolIndex = new Map<string, PersistedMessagePart>();
  const existingSignatures = new Set<string>();

  for (const [index, part] of merged.entries()) {
    if (!isRecord(part) || typeof part.type !== "string" || !part.type.startsWith("tool-")) continue;
    const callId = typeof part.toolCallId === "string" ? part.toolCallId : null;
    if (callId) toolIndex.set(callId, part);
    existingSignatures.add(`${part.type}:${callId ?? `idx-${index}`}`);
  }

  const toolCalls = Array.isArray(event.toolCalls) ? event.toolCalls : [];
  for (const call of toolCalls) {
    if (!isRecord(call)) continue;
    const resolvedName = typeof call.toolName === "string" ? resolveToolName?.(call.toolName) ?? call.toolName : call.toolName;
    const toolName = sanitizeToolName(resolvedName);
    if (!toolName) continue;
    const callId = (call.toolCallId as string) ?? null;
    const signature = `tool-${toolName}:${callId ?? "no-call-id"}`;
    if (existingSignatures.has(signature)) continue;
    const part: PersistedMessagePart = {
      type: `tool-${toolName}`,
      state: "input-available",
      input: call.input ?? null,
      toolCallId: callId,
    };
    merged.push(part);
    if (callId) toolIndex.set(callId, part);
    existingSignatures.add(signature);
  }

  const toolResults = Array.isArray(event.toolResults) ? event.toolResults : [];
  for (const result of toolResults) {
    if (!isRecord(result)) continue;
    const resolvedName = typeof result.toolName === "string" ? resolveToolName?.(result.toolName) ?? result.toolName : result.toolName;
    const toolName = sanitizeToolName(resolvedName);
    if (!toolName) continue;
    const callId = (result.toolCallId as string) ?? null;
    const existing = callId ? toolIndex.get(callId) : undefined;
    if (existing) {
      existing.state = "output-available";
      existing.output = result.output ?? null;
      continue;
    }

    const signature = `tool-${toolName}:${callId ?? "no-call-id"}`;
    if (existingSignatures.has(signature)) continue;
    merged.push({
      type: `tool-${toolName}`,
      state: "output-available",
      output: result.output ?? null,
      toolCallId: callId,
    });
    existingSignatures.add(signature);
  }

  return merged;
}

function buildAssistantPartsFromFinishEvent(
  event: unknown,
  resolveToolName?: (name: string) => string,
): PersistedMessagePart[] {
  if (!isRecord(event)) return [{ type: "text", text: "" }];

  const response = event.response;
  if (isRecord(response) && Array.isArray(response.messages)) {
    const assistantResponseMessage = [...response.messages]
      .reverse()
      .find((message) => isRecord(message) && message.role === "assistant");
    const responseParts = extractPartsFromResponseMessage(assistantResponseMessage, resolveToolName);
    if (responseParts.length > 0) {
      return mergeToolCallsAndResultsIntoParts(responseParts, event, resolveToolName);
    }
  }

  const text = typeof event.text === "string" ? event.text : "";
  const fallbackParts: PersistedMessagePart[] = [{ type: "text", text }];
  if (typeof event.reasoning === "string" && event.reasoning.trim()) {
    fallbackParts.push({ type: "reasoning", text: event.reasoning });
  }

  const fallbackToolIndex = new Map<string, PersistedMessagePart>();
  const toolCalls = Array.isArray(event.toolCalls) ? event.toolCalls : [];
  for (const call of toolCalls) {
    if (!isRecord(call)) continue;
    const resolvedName = typeof call.toolName === "string" ? resolveToolName?.(call.toolName) ?? call.toolName : call.toolName;
    const toolName = sanitizeToolName(resolvedName);
    if (!toolName) continue;
    const callId = (call.toolCallId as string) ?? null;
    const part: PersistedMessagePart = {
      type: `tool-${toolName}`,
      state: "input-available",
      input: call.input ?? null,
      toolCallId: callId,
    };
    fallbackParts.push(part);
    if (callId) fallbackToolIndex.set(callId, part);
  }

  const toolResults = Array.isArray(event.toolResults) ? event.toolResults : [];
  for (const result of toolResults) {
    if (!isRecord(result)) continue;
    const resolvedName = typeof result.toolName === "string" ? resolveToolName?.(result.toolName) ?? result.toolName : result.toolName;
    const toolName = sanitizeToolName(resolvedName);
    if (!toolName) continue;
    const callId = (result.toolCallId as string) ?? null;
    const existing = callId ? fallbackToolIndex.get(callId) : undefined;
    if (existing) {
      existing.state = "output-available";
      existing.output = result.output ?? null;
    } else {
      fallbackParts.push({
        type: `tool-${toolName}`,
        state: "output-available",
        output: result.output ?? null,
        toolCallId: callId,
      });
    }
  }

  return fallbackParts;
}

function logToolSequenceForRequest(params: {
  event: unknown;
  conversationId?: string | null;
  modelId: string;
  providerModel: string;
}) {
  const { event, conversationId, modelId, providerModel } = params;
  if (!isRecord(event)) return;

  const toolCalls = Array.isArray(event.toolCalls) ? event.toolCalls : [];
  const toolResults = Array.isArray(event.toolResults) ? event.toolResults : [];
  const resultByCallId = new Map<string, unknown>();
  for (const result of toolResults) {
    if (!isRecord(result) || typeof result.toolCallId !== "string") continue;
    resultByCallId.set(result.toolCallId, result.output);
  }

  const sequence = toolCalls
    .map((call, index) => {
      if (!isRecord(call)) return null;
      const toolCallId = typeof call.toolCallId === "string" ? call.toolCallId : null;
      const toolName = typeof call.toolName === "string" ? call.toolName : null;
      const output = toolCallId ? resultByCallId.get(toolCallId) : null;
      const outputError =
        isRecord(output) && typeof output.error === "string"
          ? output.error
          : isRecord(output) && typeof output.message === "string"
            ? output.message
            : null;
      return {
        order: index + 1,
        toolName,
        toolCallId,
        outputError,
      };
    })
    .filter((entry): entry is { order: number; toolName: string | null; toolCallId: string | null; outputError: string | null } => entry !== null);

  const firstTool = sequence[0]?.toolName ?? null;
  const calledCreateChartFirst = firstTool === CREATE_CHART_TOOL_NAME;
  const createChartGuardrailTriggered = sequence.some(
    (step) =>
      step.toolName === CREATE_CHART_TOOL_NAME &&
      typeof step.outputError === "string" &&
      step.outputError.includes("requires at least one non-create_chart data tool call"),
  );

  logWarn("[api/chat] Tool execution sequence", {
    conversationId: conversationId ?? null,
    modelId,
    providerModel,
    toolCallCount: sequence.length,
    firstTool,
    calledCreateChartFirst,
    createChartGuardrailTriggered,
    sequence,
  });
}

async function ensureProfileExists(user: { id: string; email?: string | null }) {
  const supabase = getSupabaseAdmin();
  const normalizedEmail = user.email?.toLowerCase() ?? null;
  const { error } = await supabase.from("uk_chat_profiles").upsert(
    {
      id: user.id,
      email: normalizedEmail,
      display_name: user.email ?? null,
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(`Failed to ensure profile exists: ${error.message}`);
}

async function readProfileMcpToken(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  email?: string | null;
}): Promise<string | null> {
  const { supabase, userId, email } = params;
  const { data: profile } = await supabase
    .from("uk_chat_profiles")
    .select("mcp_token,mcp_token_encrypted")
    .eq("id", userId)
    .maybeSingle();
  const encryptedToken = typeof profile?.mcp_token_encrypted === "string" ? profile.mcp_token_encrypted : null;
  const plainToken = typeof profile?.mcp_token === "string" ? profile.mcp_token : null;
  const decrypted = await decryptMcpToken(encryptedToken);
  if (decrypted) return decrypted;
  if (!plainToken) return null;
  const encrypted = await encryptMcpToken(plainToken);
  if (encrypted) {
    await supabase.from("uk_chat_profiles").update({ mcp_token_encrypted: encrypted, mcp_token: null }).eq("id", userId);
  }
  return plainToken;
}

async function claimPendingMcpToken(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  email?: string | null;
}): Promise<string | null> {
  const { supabase, userId, email } = params;
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return null;
  const { data: gate } = await supabase
    .from("uk_chat_email_gate")
    .select("pending_mcp_token")
    .eq("email", normalizedEmail)
    .maybeSingle();
  const pendingToken = typeof gate?.pending_mcp_token === "string" ? gate.pending_mcp_token : null;
  if (!pendingToken) return null;

  const encrypted = await encryptMcpToken(pendingToken);
  const profilePatch: { mcp_token: string | null; mcp_token_encrypted: string | null } = encrypted
    ? { mcp_token: null, mcp_token_encrypted: encrypted }
    : { mcp_token: pendingToken, mcp_token_encrypted: null };

  await supabase.from("uk_chat_profiles").update(profilePatch).eq("id", userId);
  await supabase.from("uk_chat_email_gate").update({ claimed_at: new Date().toISOString() }).eq("email", normalizedEmail);
  return pendingToken;
}

function utcDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function approachingThreshold(dailyLimit: number) {
  return Math.max(2, Math.ceil(dailyLimit * 0.15));
}

async function reserveModelUsageSlot({
  supabase,
  userId,
  modelId,
  dailyLimit,
}: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  modelId: string;
  dailyLimit: number;
}) {
  const usageDate = utcDateStamp();
  const { data: existing, error: existingError } = await supabase
    .from("uk_chat_model_usage")
    .select("id,request_count")
    .eq("user_id", userId)
    .eq("model_id", modelId)
    .eq("usage_date", usageDate)
    .maybeSingle();

  if (existingError) return { ok: false as const, error: existingError.message, remaining: 0 };
  if ((existing?.request_count ?? 0) >= dailyLimit) return { ok: false as const, error: null, remaining: 0 };

  const nextCount = (existing?.request_count ?? 0) + 1;
  if (existing) {
    const { error: updateError } = await supabase
      .from("uk_chat_model_usage")
      .update({ request_count: nextCount, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updateError) return { ok: false as const, error: updateError.message, remaining: 0 };
    return { ok: true as const, error: null, remaining: Math.max(0, dailyLimit - nextCount) };
  }

  const { error: insertError } = await supabase.from("uk_chat_model_usage").insert({
    user_id: userId,
    model_id: modelId,
    usage_date: usageDate,
    request_count: 1,
  });
  if (insertError) return { ok: false as const, error: insertError.message, remaining: 0 };
  return { ok: true as const, error: null, remaining: Math.max(0, dailyLimit - 1) };
}

async function getModelUsageStatus({
  supabase,
  userId,
  modelId,
  dailyLimit,
}: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  modelId: string;
  dailyLimit: number;
}) {
  const usageDate = utcDateStamp();
  const { data, error } = await supabase
    .from("uk_chat_model_usage")
    .select("request_count,total_prompt_tokens,total_completion_tokens,total_tool_calls")
    .eq("user_id", userId)
    .eq("model_id", modelId)
    .eq("usage_date", usageDate)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message, used: 0, remaining: 0, approaching: false, reached: false, tokens: { prompt: 0, completion: 0, total: 0 }, toolCalls: 0 };
  const used = data?.request_count ?? 0;
  const remaining = Math.max(0, dailyLimit - used);
  const reached = remaining <= 0;
  const approaching = !reached && remaining <= approachingThreshold(dailyLimit);
  const promptTokens = data?.total_prompt_tokens ?? 0;
  const completionTokens = data?.total_completion_tokens ?? 0;
  return {
    ok: true as const,
    error: null,
    used,
    remaining,
    approaching,
    reached,
    tokens: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
    toolCalls: data?.total_tool_calls ?? 0,
  };
}

function classifyTool(name: string, description: string): { category: ToolCatalogItem["category"]; baseScore: number } {
  const text = `${name} ${description}`.toLowerCase();
  if (/search|query|lookup|find|dataset|postcode|geocode|boundary|stats|fetch|get/.test(text)) {
    return { category: "data", baseScore: 120 };
  }
  if (/chart|summar|compare|aggregate|trend|rank|analysis|insight/.test(text)) {
    return { category: "analysis", baseScore: 95 };
  }
  if (/token|admin|email|onboard|invite|delete|rotate|auth/.test(text)) {
    return { category: "system", baseScore: 40 };
  }
  return { category: "data", baseScore: 70 };
}

function buildToolCatalog(tools: Record<string, unknown>, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const catalog = Object.entries(tools)
    .map(([name, definition]) => {
    const description =
      (isRecord(definition) && typeof definition.description === "string" ? definition.description : "Model tool") ?? "Model tool";
    const shortDescription = description.length > 120 ? `${description.slice(0, 117)}...` : description;
      const { category, baseScore } = classifyTool(name, shortDescription);
    const startsWithVerb = /^(get|list|search|query|find|fetch)/i.test(name) ? 10 : 0;
    const conciseBonus = Math.max(0, 12 - Math.min(12, name.length));
      const trustedDataBonus = /ons|nomis|nhs|boe|postcodes|parliament|metoffice|dft|fsa/i.test(name) ? 14 : 0;
      const adminPenalty = category === "system" ? -40 : 0;
      const score = baseScore + startsWithVerb + conciseBonus + trustedDataBonus + adminPenalty;
    return {
      name,
      description: shortDescription,
      category,
        score,
        recommended: false,
    };
    })
    .filter((tool) => {
      if (!normalizedQuery) return true;
      const haystack = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });

  catalog.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let recommendedCount = 0;
  for (const tool of catalog) {
    if (recommendedCount >= 12) break;
    if (tool.category === "system") continue;
    tool.recommended = true;
    recommendedCount += 1;
  }
  return catalog;
}

function extractLatestUserText(messages: Array<{ role?: string; parts?: unknown[] }> | undefined): string {
  if (!Array.isArray(messages)) return "";
  const latestUser = [...messages].reverse().find((message) => message?.role === "user");
  if (!latestUser || !Array.isArray(latestUser.parts)) return "";
  const text = latestUser.parts
    .filter((part): part is Record<string, unknown> => isRecord(part))
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join(" ")
    .trim();
  return text;
}

function shouldRequireDataToolCall(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;

  const quantitativeSignals = [
    /\bcompare\b/,
    /\btrend\b/,
    /\bchange(?:d)?\b/,
    /\bhow many\b/,
    /\bhow much\b/,
    /\bnumber of\b/,
    /\bmonthly\b/,
    /\byearly\b/,
    /\bover the last\b/,
    /\b\d{4}\b/,
    /\bchart\b/,
    /\bgraph\b/,
    /\bborough\b/,
    /\bpostcode\b/,
    /\bcrime\b/,
    /\benergy\b/,
    /\belectricity\b/,
    /\bgas\b/,
  ];

  return quantitativeSignals.some((pattern) => pattern.test(normalized));
}

function hasPriorNonChartToolOutput(messages: Array<{ role?: string; parts?: unknown[] }> | undefined): boolean {
  if (!Array.isArray(messages)) return false;
  for (const message of messages) {
    if (!message || !Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      if (!isRecord(part) || typeof part.type !== "string") continue;
      if (!part.type.startsWith("tool-")) continue;
      const toolName = part.type.slice("tool-".length);
      if (toolName !== CREATE_CHART_TOOL_NAME) return true;
    }
  }
  return false;
}

function isAutoGeneratedConversationTitle(title?: string | null): boolean {
  if (!title) return true;
  return AUTO_CHAT_TITLE_DEFAULT_REGEX.test(title.trim());
}

function sanitizeAutoChatTitle(raw: string): string | null {
  const withoutPrefix = raw.replace(/^title\s*:\s*/i, "");
  const normalized = withoutPrefix.replace(/\s+/g, " ").trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!normalized) return null;
  if (normalized.length <= AUTO_CHAT_TITLE_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, AUTO_CHAT_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

async function generateAutoChatTitleFromFirstMessage(message: string): Promise<string | null> {
  const cleanedMessage = message.replace(/\s+/g, " ").trim();
  if (!cleanedMessage) return null;
  try {
    const result = await generateText({
      model: openrouter.chat(AUTO_CHAT_TITLE_MODEL),
      temperature: 0.1,
      maxOutputTokens: 24,
      prompt: [
        "Create a concise chat title based on the user's first message.",
        "Requirements:",
        "- 3 to 8 words",
        "- Plain text only",
        "- No quotation marks",
        "- No trailing punctuation",
        "",
        `User message: ${cleanedMessage}`,
        "",
        "Title:",
      ].join("\n"),
    });
    return sanitizeAutoChatTitle(result.text);
  } catch (error) {
    logWarn("[api/chat] Failed to generate auto chat title", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function selectToolsForChat(tools: Record<string, unknown>, query: string, limit: number): Record<string, unknown> {
  const catalog = buildToolCatalog(tools, "");
  const keywords = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((keyword) => keyword.length >= 3);
  const ranked = [...catalog].sort((a, b) => {
    const aHaystack = `${a.name} ${a.description}`.toLowerCase();
    const bHaystack = `${b.name} ${b.description}`.toLowerCase();
    const aMatches = keywords.reduce((sum, keyword) => sum + (aHaystack.includes(keyword) ? 1 : 0), 0);
    const bMatches = keywords.reduce((sum, keyword) => sum + (bHaystack.includes(keyword) ? 1 : 0), 0);
    return bMatches - aMatches || b.score - a.score;
  });
  const selectedNames = new Set(ranked.slice(0, Math.max(8, limit)).map((item) => item.name));

  const selectedEntries = Object.entries(tools).filter(([name]) => selectedNames.has(name));
  return Object.fromEntries(selectedEntries);
}

function createSyntheticChartTool() {
  return {
    description: "Create a chart specification from one or more tool outputs.",
    inputSchema: jsonSchema(CREATE_CHART_INPUT_SCHEMA),
    execute: async (input: unknown) => compactCreateChartSpec(input),
  };
}

function enforceCreateChartDataPrereq(tools: Record<string, unknown>): Record<string, unknown> {
  let hasCalledNonChartDataTool = false;

  const wrappedEntries = Object.entries(tools).map(([toolName, definition]) => {
    if (!isRecord(definition)) return [toolName, definition] as const;
    const execute = definition.execute;
    if (typeof execute !== "function") return [toolName, definition] as const;

    if (toolName === CREATE_CHART_TOOL_NAME) {
      return [
        toolName,
        {
          ...definition,
          execute: async (...args: unknown[]) => {
            if (!hasCalledNonChartDataTool) {
              return {
                error:
                  "create_chart requires at least one non-create_chart data tool call earlier in this turn. Call a data retrieval tool first, then synthesize with create_chart.",
              };
            }
            return execute(...args);
          },
        },
      ] as const;
    }

    return [
      toolName,
      {
        ...definition,
        execute: async (...args: unknown[]) => {
          hasCalledNonChartDataTool = true;
          return execute(...args);
        },
      },
    ] as const;
  });

  return Object.fromEntries(wrappedEntries);
}

async function loadAuthorizedMcpTools({
  supabase,
  user,
  mcpToken,
  conversationId,
}: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  user: { id: string; email?: string | null };
  mcpToken?: string | null;
  conversationId?: string | null;
}): Promise<{ tools: Record<string, unknown> } | { response: Response }> {
  let token = mcpToken ?? (await readProfileMcpToken({ supabase, userId: user.id, email: user.email }));
  if (!token) {
    token = await claimPendingMcpToken({ supabase, userId: user.id, email: user.email });
  }
  if (!token) return { response: json({ error: "Missing MCP token" }, 400) };

  const configuredMcpUrl = env("MCP_SERVER_URL") ?? "https://mcp.explorethekingdom.co.uk/sse";
  let mcpLoad = await loadMcpToolsWithFallback(configuredMcpUrl, token);
  if (!mcpLoad.tools && isMcpUnauthorized(mcpLoad.attempts)) {
    const normalizedEmail = user.email?.trim().toLowerCase();
    if (normalizedEmail) {
      const { data: gate } = await supabase
        .from("uk_chat_email_gate")
        .select("pending_mcp_token")
        .eq("email", normalizedEmail)
        .maybeSingle();
      const pendingToken = gate?.pending_mcp_token as string | null | undefined;

      if (pendingToken && pendingToken !== token) {
        const retryLoad = await loadMcpToolsWithFallback(configuredMcpUrl, pendingToken);
        if (retryLoad.tools) {
          token = pendingToken;
          mcpLoad = retryLoad;
          const encrypted = await encryptMcpToken(pendingToken);
          await supabase
            .from("uk_chat_profiles")
            .update(encrypted ? { mcp_token: null, mcp_token_encrypted: encrypted } : { mcp_token: pendingToken })
            .eq("id", user.id);
          logWarn("[api/chat] Recovered from unauthorized MCP token using pending token", {
            userId: user.id,
            conversationId: conversationId ?? null,
          });
        } else {
          logError("[api/chat] Pending MCP token retry failed", {
            userId: user.id,
            conversationId: conversationId ?? null,
            configuredMcpUrl,
            attempts: retryLoad.attempts,
          });
        }
      }
    }
  }

  if (!mcpLoad.tools) {
    const details = mcpLoad.attempts.map((attempt) => `${attempt.type}:${attempt.url} -> ${attempt.error}`).join(" | ");
    if (isMcpUnauthorized(mcpLoad.attempts)) {
      await supabase.from("uk_chat_profiles").update({ mcp_token: null, mcp_token_encrypted: null }).eq("id", user.id);
      logError("[api/chat] MCP token unauthorized after recovery attempts", {
        userId: user.id,
        conversationId: conversationId ?? null,
        configuredMcpUrl,
        attempts: mcpLoad.attempts,
      });
      return {
        response: json(
          {
            error: "Your MCP token is no longer valid. Please ask an admin to rotate your token, then refresh and try again.",
            code: "MCP_TOKEN_UNAUTHORIZED",
          },
          401,
        ),
      };
    }
    logError("[api/chat] MCP tool connection failed", {
      userId: user.id,
      conversationId: conversationId ?? null,
      configuredMcpUrl,
      attempts: mcpLoad.attempts,
    });
    return { response: json({ error: `Unable to connect to MCP tools (${details || "no attempts"}).` }, 502) };
  }

  return { tools: mcpLoad.tools as Record<string, unknown> };
}

async function handleChatTools(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const body = (await request.json()) as {
    mcpToken?: string | null;
    query?: string;
    offset?: number;
    limit?: number;
  };
  const supabase = getSupabaseAdmin();
  const toolLoad = await loadAuthorizedMcpTools({ supabase, user, mcpToken: body.mcpToken });
  if ("response" in toolLoad) return toolLoad.response;
  const query = typeof body.query === "string" ? body.query : "";
  const offset = Math.max(0, body.offset ?? 0);
  const limit = Math.min(100, Math.max(20, body.limit ?? 50));
  const catalog = buildToolCatalog(toolLoad.tools, query);
  const items = catalog.slice(offset, offset + limit);
  const nextOffset = offset + items.length < catalog.length ? offset + items.length : null;
  return json({
    totalCount: catalog.length,
    items: items.map(({ name, description, category, recommended }) => ({ name, description, category, recommended })),
    nextOffset,
    hasMore: nextOffset !== null,
  });
}

async function handleChatUsage(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const modelId = new URL(request.url).searchParams.get("modelId");
  const selectedModel = getChatModelConfig(modelId);
  const supabase = getSupabaseAdmin();
  const usage = await getModelUsageStatus({
    supabase,
    userId: user.id,
    modelId: selectedModel.id,
    dailyLimit: selectedModel.dailyLimit,
  });
  if (!usage.ok) return json({ error: usage.error }, 500);
  const banner = usage.reached
    ? `Daily ${selectedModel.label} limit reached - ${CHAT_SUPPORT_CONTACT}.`
    : usage.approaching
      ? `${selectedModel.label} limit nearly reached (${usage.remaining} remaining today).`
      : null;
  return json({
    modelId: selectedModel.id,
    label: selectedModel.label,
    dailyLimit: selectedModel.dailyLimit,
    used: usage.used,
    remaining: usage.remaining,
    approaching: usage.approaching,
    reached: usage.reached,
    tokens: usage.tokens,
    toolCalls: usage.toolCalls,
    banner,
  });
}

async function handleChatUsageAll(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const usageDate = utcDateStamp();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("uk_chat_model_usage")
    .select("model_id,request_count,total_prompt_tokens,total_completion_tokens,total_tool_calls")
    .eq("user_id", user.id)
    .eq("usage_date", usageDate);

  if (error) return json({ error: error.message }, 500);

  type DailyModelUsage = {
    requests: number;
    promptTokens: number;
    completionTokens: number;
    toolCalls: number;
  };
  const usageByModelId = new Map<string, DailyModelUsage>();
  for (const row of data ?? []) {
    const existing = usageByModelId.get(row.model_id);
    const requests = (existing?.requests ?? 0) + (row.request_count ?? 0);
    const promptTokens = (existing?.promptTokens ?? 0) + (row.total_prompt_tokens ?? 0);
    const completionTokens = (existing?.completionTokens ?? 0) + (row.total_completion_tokens ?? 0);
    const toolCalls = (existing?.toolCalls ?? 0) + (row.total_tool_calls ?? 0);
    usageByModelId.set(row.model_id, { requests, promptTokens, completionTokens, toolCalls });
  }

  const models = CHAT_MODEL_CONFIGS.map((model) => {
    const usage = usageByModelId.get(model.id);
    const used = usage?.requests ?? 0;
    const remaining = Math.max(0, model.dailyLimit - used);
    const reached = remaining <= 0;
    const approaching = !reached && remaining <= approachingThreshold(model.dailyLimit);
    return {
      id: model.id,
      label: model.label,
      dailyLimit: model.dailyLimit,
      used,
      remaining,
      approaching,
      reached,
      tokens: {
        prompt: usage?.promptTokens ?? 0,
        completion: usage?.completionTokens ?? 0,
        total: (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0),
      },
      toolCalls: usage?.toolCalls ?? 0,
    };
  });

  return json({ models });
}

async function handleChat(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const body = (await request.json()) as {
    messages?: Array<{ role?: string; parts?: unknown[] }>;
    mcpToken?: string | null;
    conversationId?: string | null;
    modelId?: string | null;
    documents?: unknown;
  };
  const supabase = getSupabaseAdmin();
  if (!body.conversationId) return json({ error: "Missing conversationId" }, 400);
  const { data: conversation } = await supabase
    .from("uk_chat_conversations")
    .select("id,title")
    .eq("id", body.conversationId)
    .eq("user_id", user.id)
    .single();
  if (!conversation) return json({ error: "Conversation not found" }, 404);
  const selectedModel = getChatModelConfig(body.modelId);
  const incomingDocuments = sanitizeIncomingDocuments(body.documents);
  const usageReservation = await reserveModelUsageSlot({
    supabase,
    userId: user.id,
    modelId: selectedModel.id,
    dailyLimit: selectedModel.dailyLimit,
  });
  if (!usageReservation.ok) {
    if (usageReservation.error) return json({ error: usageReservation.error }, 500);
    return json(
      {
        error: `You've hit today's conservative limit for ${selectedModel.label}. Please try again tomorrow - ${CHAT_SUPPORT_CONTACT}.`,
        code: "MODEL_USAGE_LIMIT_REACHED",
      },
      429,
    );
  }
  const toolLoad = await loadAuthorizedMcpTools({
    supabase,
    user,
    mcpToken: body.mcpToken,
    conversationId: body.conversationId,
  });
  if ("response" in toolLoad) return toolLoad.response;
  const tools = compactMcpToolsForModelContext(toolLoad.tools);
  const latestUserQuery = extractLatestUserText(body.messages);
  const requireDataToolCall = shouldRequireDataToolCall(latestUserQuery);
  const priorDataToolOutputExists = hasPriorNonChartToolOutput(body.messages);
  const allowCreateChartTool = !requireDataToolCall || priorDataToolOutputExists;
  const scopedTools = {
    ...selectToolsForChat(tools, latestUserQuery, 18),
    ...(allowCreateChartTool ? { [CREATE_CHART_TOOL_NAME]: createSyntheticChartTool() } : {}),
  };
  const guardedTools = enforceCreateChartDataPrereq(scopedTools);
  const { projectedTools, projectedToolNames } = projectToolSchemasForModel(guardedTools, selectedModel.id);

  const { normalizedTools, normalizedToolNames } = normalizeToolSchemas(projectedTools);
  const { safeTools, safeToOriginal, renamedPairs } = buildProviderSafeTools(normalizedTools);
  if (projectedToolNames.length > 0) {
    logWarn("[api/chat] Applied model-specific tool schema projection", {
      modelId: selectedModel.id,
      projectedCount: projectedToolNames.length,
      projectedToolNames,
    });
  }
  if (normalizedToolNames.length > 0) {
    logWarn("[api/chat] Normalized Gemini-incompatible MCP schemas", {
      normalizedCount: normalizedToolNames.length,
      normalizedToolNames,
    });
  }
  logWarn("[api/chat] Scoped tool catalog for request", {
    totalTools: Object.keys(tools).length,
    selectedTools: Object.keys(scopedTools).length,
    query: latestUserQuery.slice(0, 180),
    requireDataToolCall,
    allowCreateChartTool,
    priorDataToolOutputExists,
  });
  if (renamedPairs.length > 0) {
    logWarn("[api/chat] Remapped tool names for provider compatibility", {
      renamedCount: renamedPairs.length,
      renamedPairs: renamedPairs.slice(0, 12),
    });
  }

  const latestUserMessage = [...(body.messages ?? [])].reverse().find((message) => message.role === "user");
  let shouldAutoNameConversation = false;
  if (latestUserMessage && isAutoGeneratedConversationTitle(conversation.title)) {
    const { data: existingUserMessage } = await supabase
      .from("uk_chat_messages")
      .select("id")
      .eq("conversation_id", body.conversationId)
      .eq("role", "user")
      .limit(1)
      .maybeSingle();
    shouldAutoNameConversation = !existingUserMessage;
  }

  if (latestUserMessage) {
    const userParts = Array.isArray(latestUserMessage.parts) ? [...latestUserMessage.parts] : [];
    incomingDocuments.forEach((document) => userParts.push(document));
    userParts.push({ type: "meta-model", modelId: selectedModel.id });
    const { error: insertUserError } = await supabase.from("uk_chat_messages").insert({
      conversation_id: body.conversationId,
      role: "user",
      parts: userParts,
    });
    if (insertUserError) {
      logError("[api/chat] Failed to persist user message", {
        conversationId: body.conversationId,
        userId: user.id,
        error: insertUserError.message,
        code: insertUserError.code ?? null,
      });
      return json({ error: "Failed to save your message. Please try again." }, 500);
    }
  }

  if (shouldAutoNameConversation) {
    const firstUserText = extractLatestUserText(body.messages);
    if (firstUserText) {
      const autoTitlePromise = (async () => {
        const generatedTitle = await generateAutoChatTitleFromFirstMessage(firstUserText);
        if (!generatedTitle) return;
        const { error: autoTitleUpdateError } = await supabase
          .from("uk_chat_conversations")
          .update({ title: generatedTitle, updated_at: new Date().toISOString() })
          .eq("id", body.conversationId!)
          .eq("user_id", user.id)
          .eq("title", conversation.title);
        if (autoTitleUpdateError) {
          logWarn("[api/chat] Failed to persist auto chat title", {
            conversationId: body.conversationId,
            userId: user.id,
            error: autoTitleUpdateError.message,
            code: autoTitleUpdateError.code ?? null,
          });
        }
      })();
      try {
        waitUntil(autoTitlePromise);
      } catch {
        // Local dev can run outside a waitUntil-capable runtime.
      }
    }
  }

  const documentContext = await loadConversationDocumentContext({
    supabase,
    conversationId: body.conversationId,
  });
  const systemPromptBase = getSystemPrompt(new Date(), selectedModel.id);
  const systemPrompt = documentContext ? `${systemPromptBase}\n\n${documentContext}` : systemPromptBase;
  const compactedMessages = compactMessagesForModel(body.messages ?? []);
  if (Array.isArray(body.messages) && compactedMessages.length !== body.messages.length) {
    logWarn("[api/chat] Compacted message history for model context", {
      originalCount: body.messages.length,
      compactedCount: compactedMessages.length,
    });
  }
  const compactedChars = compactedMessages.reduce((sum, message) => sum + message.content.length, 0);
  if (compactedChars > 40_000) {
    logWarn("[api/chat] Compacted message payload is still large", {
      compactedCount: compactedMessages.length,
      compactedChars,
    });
  }

  const onAssistantFinish: Parameters<typeof streamText>[0]["onFinish"] = async (event) => {
    logToolSequenceForRequest({
      event,
      conversationId: body.conversationId,
      modelId: selectedModel.id,
      providerModel: selectedModel.providerModel,
    });

    const persistPromise = (async () => {
      const assistantParts = buildAssistantPartsFromFinishEvent(event, (name) => safeToOriginal.get(name) ?? name);
      const { error: assistantInsertError } = await supabase.from("uk_chat_messages").insert({
        conversation_id: body.conversationId!,
        role: "assistant",
        parts: assistantParts,
      });
      if (assistantInsertError) {
        logError("[api/chat] Failed to persist assistant message", {
          conversationId: body.conversationId,
          userId: user.id,
          error: assistantInsertError.message,
          code: assistantInsertError.code ?? null,
        });
        return;
      }

      const { error: updateConversationError } = await supabase
        .from("uk_chat_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", body.conversationId!)
        .eq("user_id", user.id);
      if (updateConversationError) {
        logError("[api/chat] Failed to update conversation timestamp", {
          conversationId: body.conversationId,
          userId: user.id,
          error: updateConversationError.message,
          code: updateConversationError.code ?? null,
        });
      }
    })();

    const tokenTrackingPromise = (async () => {
      const promptTokens = event.usage?.promptTokens ?? 0;
      const completionTokens = event.usage?.completionTokens ?? 0;
      const toolCallCount = Array.isArray(event.toolCalls) ? event.toolCalls.length : 0;
      if (promptTokens === 0 && completionTokens === 0 && toolCallCount === 0) return;

      const { error: tokenError } = await supabase.rpc("increment_token_usage", {
        p_user_id: user.id,
        p_model_id: selectedModel.id,
        p_usage_date: utcDateStamp(),
        p_prompt_tokens: promptTokens,
        p_completion_tokens: completionTokens,
        p_tool_calls: toolCallCount,
      });
      if (tokenError) {
        logError("[api/chat] Failed to persist token usage", {
          conversationId: body.conversationId,
          userId: user.id,
          modelId: selectedModel.id,
          promptTokens,
          completionTokens,
          toolCallCount,
          error: tokenError.message,
        });
      }
    })();

    try {
      waitUntil(persistPromise);
      waitUntil(tokenTrackingPromise);
    } catch {
      // Local dev can run outside a waitUntil-capable runtime.
    }
    await Promise.all([persistPromise, tokenTrackingPromise]);
  };

  const fallbackModels = getOpenRouterFallbackModels(selectedModel.id);
  const tryStream = (options: {
    includeFallbackModels: boolean;
    includeTools: boolean;
    requireToolCall: boolean;
  }) =>
    streamText({
      model: openrouter.chat(selectedModel.providerModel, {
        extraBody: options.includeFallbackModels && fallbackModels.length > 0 ? { models: fallbackModels } : undefined,
      }),
      messages: compactedMessages,
      tools: options.includeTools ? (safeTools as Parameters<typeof streamText>[0]["tools"]) : undefined,
      toolChoice: options.includeTools ? (options.requireToolCall ? "required" : "auto") : undefined,
      stopWhen: stepCountIs(10),
      system: systemPrompt,
      onFinish: onAssistantFinish,
    });

  let result: ReturnType<typeof streamText>;
  try {
    result = tryStream({
      includeFallbackModels: true,
      includeTools: true,
      requireToolCall: requireDataToolCall,
    });
  } catch (error) {
    if (!isProviderInvalidRequestError(error)) throw error;
    logWarn("[api/chat] Provider rejected request, retrying without fallback model chain", {
      modelId: selectedModel.id,
      providerModel: selectedModel.providerModel,
      requireDataToolCall,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      result = tryStream({
        includeFallbackModels: false,
        includeTools: true,
        requireToolCall: requireDataToolCall,
      });
    } catch (retryError) {
      if (!isProviderInvalidRequestError(retryError)) throw retryError;
      if (requireDataToolCall) {
        logWarn("[api/chat] Provider rejected required tool choice, retrying with auto tool choice", {
          modelId: selectedModel.id,
          providerModel: selectedModel.providerModel,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        });
        try {
          result = tryStream({
            includeFallbackModels: false,
            includeTools: true,
            requireToolCall: false,
          });
        } catch (autoToolChoiceError) {
          if (!isProviderInvalidRequestError(autoToolChoiceError)) throw autoToolChoiceError;
          logWarn("[api/chat] Provider still rejected request, retrying without tools", {
            modelId: selectedModel.id,
            providerModel: selectedModel.providerModel,
            error: autoToolChoiceError instanceof Error ? autoToolChoiceError.message : String(autoToolChoiceError),
          });
          result = tryStream({ includeFallbackModels: false, includeTools: false, requireToolCall: false });
        }
      } else {
        logWarn("[api/chat] Provider still rejected request, retrying without tools", {
          modelId: selectedModel.id,
          providerModel: selectedModel.providerModel,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        });
        result = tryStream({ includeFallbackModels: false, includeTools: false, requireToolCall: false });
      }
    }
  }

  return result.toUIMessageStreamResponse();
}

function isCouncilResolvedGeography(value: unknown): value is CouncilResolvedGeography {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.displayName === "string";
}

function isCouncilDeliberation(value: unknown): value is CouncilDeliberation {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.councilId === "string" &&
    typeof row.conversationId === "string" &&
    typeof row.issue === "string" &&
    Array.isArray(row.agents) &&
    Array.isArray(row.turns) &&
    typeof row.createdAt === "string"
  );
}

function extractAreaCandidate(text: string): string | null {
  const compact = text.replace(/\s+/g, " ").trim();
  const patterns = [
    /\bconstituency\s+([a-z0-9][a-z0-9\s'&-]{2,60}?)(?:\b(?:for|on|about|regarding|with|where|which)\b|[,.!?;]|$)/i,
    /\b(?:in|for|around|near)\s+([a-z][a-z\s'&-]{2,50}?)(?:\b(?:for|on|about|regarding|with|where|which)\b|[,.!?;]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = compact.match(pattern);
    const candidate = match?.[1]?.trim();
    if (!candidate) continue;
    if (["my area", "the area", "my constituency", "the constituency"].includes(candidate.toLowerCase())) continue;
    return candidate.replace(/[,.!?;]+$/, "");
  }
  return null;
}

function inferCouncilScopeDeterministic(text: string): CouncilScope {
  const postcodeMatch = text.match(UK_POSTCODE_REGEX);
  if (postcodeMatch?.[1]) {
    return { kind: "postcode", postcode: postcodeMatch[1].replace(/\s+/g, "").toUpperCase() };
  }
  const area = extractAreaCandidate(text);
  if (area) return { kind: "area", area };
  return { kind: "national" };
}

function normalizeCouncilScopeFromLlm(raw: unknown): CouncilScope | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const scopeKind = typeof row.scopeKind === "string" ? row.scopeKind.toLowerCase() : "";
  if (scopeKind === "postcode") {
    const postcode = typeof row.postcode === "string" ? row.postcode.trim() : "";
    if (!postcode) return null;
    return { kind: "postcode", postcode: postcode.replace(/\s+/g, "").toUpperCase() };
  }
  if (scopeKind === "area") {
    const area = typeof row.area === "string" ? row.area.trim() : "";
    if (!area) return null;
    return { kind: "area", area };
  }
  if (scopeKind === "national") {
    return { kind: "national" };
  }
  return null;
}

async function handleCouncilInferScope(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const parsed = parseCouncilInferScopeRequest(await request.json());
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const deterministic = inferCouncilScopeDeterministic(parsed.data.text);
  if (deterministic.kind === "postcode") {
    return json({ scope: deterministic, source: "regex", confidence: "high" });
  }

  const selectedModel = getChatModelConfig(parsed.data.modelId);
  try {
    const result = await generateText({
      model: openrouter.chat(selectedModel.providerModel),
      temperature: 0,
      maxOutputTokens: 140,
      prompt: [
        "Extract geographic scope for UK civic council setup.",
        'Return ONLY JSON with fields: {"scopeKind":"postcode|area|national","postcode":"","area":"","confidence":"low|medium|high"}',
        "Rules:",
        "- If a UK postcode appears, choose postcode.",
        "- If a specific place or constituency appears, choose area and provide minimal area text.",
        "- If no reliable local place exists, choose national.",
        "",
        `User text: ${parsed.data.text}`,
      ].join("\n"),
    });
    const llmJson = parseJsonSafely(result.text);
    const normalized = normalizeCouncilScopeFromLlm(llmJson);
    if (normalized) {
      const confidence =
        llmJson && typeof llmJson === "object" && typeof (llmJson as Record<string, unknown>).confidence === "string"
          ? String((llmJson as Record<string, unknown>).confidence)
          : "medium";
      return json({ scope: normalized, source: "llm", confidence });
    }
  } catch (error) {
    logWarn("[api/council/infer-scope] LLM scope extraction failed", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return json({ scope: deterministic, source: "deterministic-fallback", confidence: "low" });
}

async function handleCouncilCreate(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const parsed = parseCouncilCreateRequest(await request.json());
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const supabase = getSupabaseAdmin();
  const { data: conversation } = await supabase
    .from("uk_chat_conversations")
    .select("id")
    .eq("id", parsed.data.conversationId)
    .eq("user_id", user.id)
    .single();
  if (!conversation) return json({ error: "Conversation not found" }, 404);

  const toolLoad = await loadAuthorizedMcpTools({
    supabase,
    user,
    mcpToken: parsed.data.mcpToken,
    conversationId: parsed.data.conversationId,
  });
  if ("response" in toolLoad) return toolLoad.response;
  const selectedModel = getChatModelConfig(parsed.data.modelId);

  const draft = await createCouncilDeliberation({
    conversationId: parsed.data.conversationId,
    issue: parsed.data.issue,
    scope: parsed.data.scope,
    tools: toolLoad.tools,
    model: openrouter.chat(selectedModel.providerModel),
  });

  const councilId = crypto.randomUUID();
  const { error: insertCouncilError } = await supabase.from("uk_chat_councils").insert({
    id: councilId,
    conversation_id: draft.conversationId,
    user_id: user.id,
    issue: draft.issue,
    scope: draft.resolvedGeography.scope,
    resolved_geography: draft.resolvedGeography,
    routing: draft.routing,
    agents: draft.agents,
    resolution: draft.resolution,
    created_at: draft.createdAt,
    updated_at: draft.createdAt,
  });
  if (insertCouncilError) return json({ error: insertCouncilError.message }, 500);

  const { error: insertTurnsError } = await supabase.from("uk_chat_council_turns").insert({
    council_id: councilId,
    turns: draft.turns,
    source: "initial",
    created_at: draft.createdAt,
  });
  if (insertTurnsError) return json({ error: insertTurnsError.message }, 500);

  const userParts = [
    {
      type: "text",
      text: `Create council (${parsed.data.scope.kind}) for ${draft.resolvedGeography.displayName}: ${draft.issue}`,
    },
  ];
  const assistantParts = [
    {
      type: "text",
      text: `Created a ${parsed.data.scope.kind === "national" ? "national" : "local"} council for ${draft.resolvedGeography.displayName}.`,
    },
    {
      type: "tool-council_deliberation",
      state: "output-available",
      output: {
        councilId,
        issue: draft.issue,
        routing: draft.routing,
        agents: draft.agents,
        turns: draft.turns,
        resolution: draft.resolution,
        scope: draft.resolvedGeography.scope,
        displayName: draft.resolvedGeography.displayName,
      },
      toolCallId: `council-${councilId}`,
    },
  ];

  await supabase.from("uk_chat_messages").insert([
    { conversation_id: draft.conversationId, role: "user", parts: userParts },
    { conversation_id: draft.conversationId, role: "assistant", parts: assistantParts },
  ]);
  await supabase
    .from("uk_chat_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", draft.conversationId)
    .eq("user_id", user.id);

  return json({
    councilId,
    issue: draft.issue,
    routing: draft.routing,
    agents: draft.agents,
    turns: draft.turns,
    resolution: draft.resolution,
    resolvedGeography: draft.resolvedGeography,
    createdAt: draft.createdAt,
  });
}

async function handleCouncilFollowUp(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const parsed = parseCouncilFollowUpRequest(await request.json());
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const supabase = getSupabaseAdmin();

  const { data: council, error: councilError } = await supabase
    .from("uk_chat_councils")
    .select("id,conversation_id,user_id,issue,routing,agents,resolved_geography,resolution")
    .eq("id", parsed.data.councilId)
    .eq("user_id", user.id)
    .single();
  if (councilError || !council) return json({ error: "Council not found" }, 404);

  const { data: turnsRows } = await supabase
    .from("uk_chat_council_turns")
    .select("turns")
    .eq("council_id", parsed.data.councilId)
    .order("created_at", { ascending: true });
  const existingTurns = (turnsRows ?? []).flatMap((row) => (Array.isArray(row.turns) ? row.turns : []));
  if (!isCouncilResolvedGeography(council.resolved_geography)) return json({ error: "Council geography is invalid." }, 500);

  const toolLoad = await loadAuthorizedMcpTools({
    supabase,
    user,
    mcpToken: parsed.data.mcpToken,
    conversationId: council.conversation_id,
  });
  if ("response" in toolLoad) return toolLoad.response;
  const selectedModel = getChatModelConfig(parsed.data.modelId);

  const next = await continueCouncilDeliberation({
    model: openrouter.chat(selectedModel.providerModel),
    issue: council.issue,
    followUp: parsed.data.followUp,
    routing: council.routing as CouncilDeliberation["routing"],
    agents: Array.isArray(council.agents) ? (council.agents as CouncilDeliberation["agents"]) : [],
    resolvedGeography: council.resolved_geography,
    existingTurns: existingTurns as CouncilDeliberation["turns"],
  });

  const now = new Date().toISOString();
  const { error: insertTurnsError } = await supabase.from("uk_chat_council_turns").insert({
    council_id: parsed.data.councilId,
    turns: next.turns,
    source: "follow_up",
    created_at: now,
  });
  if (insertTurnsError) return json({ error: insertTurnsError.message }, 500);

  const { error: updateCouncilError } = await supabase
    .from("uk_chat_councils")
    .update({ resolution: next.resolution, updated_at: now })
    .eq("id", parsed.data.councilId)
    .eq("user_id", user.id);
  if (updateCouncilError) return json({ error: updateCouncilError.message }, 500);

  const assistantPayload = {
    councilId: parsed.data.councilId,
    issue: council.issue,
    routing: council.routing,
    agents: council.agents,
    turns: next.turns,
    resolution: next.resolution,
    scope: council.resolved_geography.scope,
    displayName: council.resolved_geography.displayName,
  };
  await supabase.from("uk_chat_messages").insert([
    { conversation_id: council.conversation_id, role: "user", parts: [{ type: "text", text: parsed.data.followUp }] },
    {
      conversation_id: council.conversation_id,
      role: "assistant",
      parts: [
        { type: "text", text: "Updated council deliberation with your follow-up." },
        {
          type: "tool-council_deliberation",
          state: "output-available",
          output: assistantPayload,
          toolCallId: `council-followup-${parsed.data.councilId}`,
        },
      ],
    },
  ]);
  await supabase
    .from("uk_chat_conversations")
    .update({ updated_at: now })
    .eq("id", council.conversation_id)
    .eq("user_id", user.id);

  return json(assistantPayload);
}

async function handleConversationsIndex(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  try {
    await ensureProfileExists(user);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to prepare user profile";
    return json({ error: message }, 500);
  }
  const supabase = getSupabaseAdmin();

  if (request.method === "GET") {
    const { data, error } = await supabase
      .from("uk_chat_conversations")
      .select(CONVERSATION_SELECT_FIELDS)
      .eq("user_id", user.id)
      .order("starred", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) return json({ error: error.message }, 400);
    return json(data ?? []);
  }

  if (request.method === "POST") {
    const { title } = (await request.json()) as { title?: string };
    const payload = { user_id: user.id, title: title?.trim() || "New chat" };
    const createConversation = () =>
      supabase.from("uk_chat_conversations").insert(payload).select(CONVERSATION_SELECT_FIELDS).single();

    let { data, error } = await createConversation();

    // If profile creation and first conversation insert race, recover once.
    if (error && error.code === "23503") {
      try {
        await ensureProfileExists(user);
      } catch (ensureError) {
        const message = ensureError instanceof Error ? ensureError.message : "Failed to prepare user profile";
        return json({ error: message }, 500);
      }
      const retry = await createConversation();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      const status = error.code?.startsWith("22") ? 400 : 500;
      return json({ error: error.message }, status);
    }

    return json(data, 201);
  }

  return json({ error: "Method not allowed" }, 405);
}

async function handleConversationById(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const id = getConversationId(request);
  const supabase = getSupabaseAdmin();

  if (request.method === "PATCH") {
    const { title, starred } = (await request.json()) as { title?: string; starred?: boolean };
    const updates: { title?: string; starred?: boolean; updated_at: string } = {
      updated_at: new Date().toISOString(),
    };
    if (typeof title === "string") updates.title = title.trim() || "Untitled";
    if (typeof starred === "boolean") updates.starred = starred;
    const { data, error } = await supabase
      .from("uk_chat_conversations")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select(CONVERSATION_SELECT_FIELDS)
      .single();
    if (error) return json({ error: error.message }, 400);
    return json(data);
  }

  if (request.method === "GET") {
    const { data: conversation, error: conversationError } = await supabase
      .from("uk_chat_conversations")
      .select(CONVERSATION_SELECT_FIELDS)
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (conversationError) {
      logWarn("[api/conversations/:id] lookup failed", {
        conversationId: id,
        userId: user.id,
        userEmail: user.email ?? null,
        error: conversationError.message,
        code: conversationError.code ?? null,
      });
      return json({ error: conversationError.message }, 404);
    }

    const { data: messages, error: messageError } = await supabase
      .from("uk_chat_messages")
      .select("id,conversation_id,role,parts,created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    if (messageError) return json({ error: messageError.message }, 400);

    return json({ conversation, messages: messages ?? [] });
  }

  if (request.method === "DELETE") {
    const { error } = await supabase.from("uk_chat_conversations").delete().eq("id", id).eq("user_id", user.id);
    if (error) return json({ error: error.message }, 400);
    return json({ success: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function handleConversationShare(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const id = getConversationId(request);
  const supabase = getSupabaseAdmin();

  const { data: conversation, error: conversationError } = await supabase
    .from("uk_chat_conversations")
    .select("id,title,is_public,share_token")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (conversationError || !conversation) {
    return json({ error: "Conversation not found" }, 404);
  }

  if (request.method === "PATCH") {
    const body = (await request.json().catch(() => ({}))) as {
      enabled?: boolean;
      expiresInDays?: number;
    };
    if (typeof body.enabled !== "boolean") return json({ error: "enabled must be boolean" }, 400);
    const now = new Date().toISOString();
    const enabled = body.enabled;
    const expiresInDays = typeof body.expiresInDays === "number" ? Math.max(1, Math.min(365, Math.round(body.expiresInDays))) : DEFAULT_SHARE_EXPIRY_DAYS;
    const nextShareToken = enabled ? conversation.share_token ?? createShareToken() : null;
    const { data, error } = await supabase
      .from("uk_chat_conversations")
      .update({
        is_public: enabled,
        share_token: nextShareToken,
        shared_at: enabled ? now : null,
        share_expires_at: enabled ? buildShareExpiryIso(expiresInDays) : null,
        updated_at: now,
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .select(CONVERSATION_SELECT_FIELDS)
      .single();
    if (error || !data) return json({ error: error?.message ?? "Failed to update share settings" }, 400);
    if (enabled && nextShareToken) {
      const shareUrl = `${getAuthRedirectBase(request).replace(/\/+$/, "")}/shared/${nextShareToken}`;
      return json({ conversation: data, shareUrl });
    }
    return json({ conversation: data, shareUrl: null });
  }

  const shareToken = conversation.share_token ?? createShareToken();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("uk_chat_conversations")
    .update({
      is_public: true,
      share_token: shareToken,
      shared_at: now,
      share_expires_at: buildShareExpiryIso(DEFAULT_SHARE_EXPIRY_DAYS),
      updated_at: now,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select(CONVERSATION_SELECT_FIELDS)
    .single();
  if (error || !data) return json({ error: error?.message ?? "Failed to share conversation" }, 400);

  const shareUrl = `${getAuthRedirectBase(request).replace(/\/+$/, "")}/shared/${shareToken}`;
  return json({ conversation: data, shareUrl });
}

function extractSharedArtifacts(messages: Array<{ id: string; parts: unknown[] }>) {
  const artifacts: Array<{ id: string; toolName: string; title: string; data: unknown }> = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (!isRecord(part) || typeof part.type !== "string" || !part.type.startsWith("tool-")) continue;
      const toolName = part.type.replace("tool-", "");
      artifacts.push({
        id: `${message.id}:${part.type}`,
        toolName,
        title: `Tool: ${toolName}`,
        data: part,
      });
    }
  }
  return artifacts;
}

async function handleSharedConversation(request: Request) {
  const token = getSharedToken(request);
  if (!token) return json({ error: "Not found" }, 404);
  const supabase = getSupabaseAdmin();

  const { data: conversation, error: conversationError } = await supabase
    .from("uk_chat_conversations")
    .select(SHARED_CONVERSATION_SELECT_FIELDS)
    .eq("share_token", token)
    .eq("is_public", true)
    .single();
  if (conversationError || !conversation) {
    return json({ error: "Shared conversation not found" }, 404);
  }
  if (conversation.share_expires_at && new Date(conversation.share_expires_at).getTime() < Date.now()) {
    return json({ error: "Shared conversation link has expired" }, 410);
  }

  const { data: messages, error: messageError } = await supabase
    .from("uk_chat_messages")
    .select("id,conversation_id,role,parts,created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true });
  if (messageError) return json({ error: messageError.message }, 400);

  const normalizedMessages = (messages ?? []).map((message) => ({
    ...message,
    parts: Array.isArray(message.parts) ? message.parts : [],
  }));

  return json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
    },
    messages: normalizedMessages,
    artifacts: extractSharedArtifacts(normalizedMessages),
  });
}

function isDevBypassEnabled(): boolean {
  const maybeProcess = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return maybeProcess.process?.env?.DEV_BYPASS_EMAIL_GATE === "true";
}

async function handleCheckEmail(request: Request) {
  const { email } = (await request.json()) as { email?: string };
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return json({ error: "Email is required" }, 400);
  }

  if (isDevBypassEnabled()) {
    return json({ allowed: true, message: "Dev bypass: any email accepted." });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("uk_chat_email_gate").select("email").eq("email", normalizedEmail).maybeSingle();
  if (error) return json({ error: "Unable to verify email access right now" }, 500);
  if (!data) return json({ allowed: false, message: "Email not found. Ask Jethro to get you access." }, 404);

  return json({
    allowed: true,
    message: "Email recognized. Use the magic link that was sent to your inbox by your admin.",
  });
}

async function handleRecognizedSignIn(request: Request) {
  const { email } = (await request.json()) as { email?: string };
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return json({ error: "Email is required" }, 400);
  }

  const supabase = getSupabaseAdmin();

  if (!isDevBypassEnabled()) {
    const { data: gateRow, error: gateError } = await supabase
      .from("uk_chat_email_gate")
      .select("email")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (gateError) return json({ error: "Unable to verify email access right now" }, 500);
    if (!gateRow) {
      return json({
        allowed: false,
        message: "Email not found. Ask Jethro to get you access.",
      });
    }
  }

  const redirectBase = getAuthRedirectBase(request);
  const callbackUrl = `${redirectBase.replace(/\/+$/, "")}/auth/callback`;
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: normalizedEmail,
    options: {
      redirectTo: callbackUrl,
    },
  });
  if (linkError) {
    return json({ error: "Unable to sign in right now. Please try again." }, 500);
  }

  const actionLink = linkData?.properties?.action_link;
  if (!actionLink) return json({ error: "Unable to sign in right now. Please try again." }, 500);

  let finalLink = actionLink;
  const parsed = new URL(actionLink);
  parsed.searchParams.set("redirect_to", callbackUrl);
  finalLink = parsed.toString();

  return json({ allowed: true, redirectTo: finalLink });
}

async function getProfileTokenMapByEmail(emails: string[]) {
  const supabase = getSupabaseAdmin();
  let page = 1;
  const perPage = 200;
  const out = new Map<string, string | null>();
  const emailSet = new Set(emails.map((email) => email.toLowerCase()));
  while (page < 50 && emailSet.size > 0) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) break;
    const users = data.users ?? [];
    if (users.length === 0) break;
    const matchingIds: string[] = [];
    const idToEmail = new Map<string, string>();
    for (const user of users) {
      const email = user.email?.toLowerCase();
      if (!email || !emailSet.has(email)) continue;
      matchingIds.push(user.id);
      idToEmail.set(user.id, email);
    }
    if (matchingIds.length > 0) {
      const { data: profiles } = await supabase.from("uk_chat_profiles").select("id,mcp_token,mcp_token_encrypted").in("id", matchingIds);
      for (const profile of profiles ?? []) {
        const email = idToEmail.get(profile.id);
        if (!email) continue;
        const decrypted = await decryptMcpToken(typeof profile.mcp_token_encrypted === "string" ? profile.mcp_token_encrypted : null);
        out.set(email, decrypted ?? profile.mcp_token ?? null);
        emailSet.delete(email);
      }
    }
    if (users.length < perPage) break;
    page += 1;
  }
  return out;
}

async function handleAdminUsers(request: Request) {
  const admin = await ensureAdmin(request);
  if ("error" in admin) return admin.error;

  if (request.method === "GET") {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("uk_chat_email_gate")
      .select("email,claimed_at,pending_mcp_token")
      .order("invited_at", { ascending: false });
    if (error) return json({ error: error.message }, 400);
    const emails = (data ?? []).map((row) => row.email);
    const profileTokenMap = await getProfileTokenMapByEmail(emails);
    await writeAdminAuditLog({
      actorUserId: admin.user.id,
      actorEmail: admin.user.email ?? null,
      action: "admin.users.list",
      metadata: { count: (data ?? []).length },
    });
    return json(
      (data ?? []).map((row) => ({
        email: row.email,
        status: row.claimed_at ? "claimed" : "invited",
        hasToken: Boolean(row.pending_mcp_token) || Boolean(profileTokenMap.get(row.email.toLowerCase())),
      })),
    );
  }

  if (request.method === "POST") {
    const { email } = (await request.json()) as { email?: string };
    if (!email) return json({ error: "Email is required" }, 400);
    try {
      const result = await onboardUser({ email, sendEmail: true });
      await writeAdminAuditLog({
        actorUserId: admin.user.id,
        actorEmail: admin.user.email ?? null,
        action: "admin.users.invite",
        target: result.email,
        metadata: { tokenIssued: Boolean(result.tokenIssued), emailSent: Boolean(result.emailSent) },
      });
      return json({
        message: "User invited, token issued, and magic link email sent",
        user: { email: result.email, status: "invited", hasToken: Boolean(result.token) },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Onboarding failed";
      return json({ error: message }, 400);
    }
  }

  return json({ error: "Method not allowed" }, 405);
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  let page = 1;
  const perPage = 200;
  while (page < 50) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) break;
    const users = data.users ?? [];
    if (users.length === 0) break;
    const match = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (users.length < perPage) break;
    page += 1;
  }
  return null;
}

async function handleAdminTokens(request: Request) {
  const admin = await ensureAdmin(request);
  if ("error" in admin) return admin.error;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { email } = (await request.json()) as { email?: string };
  if (!email) return json({ error: "Email is required" }, 400);
  try {
    const result = await onboardUser({ email, rotateToken: true, sendEmail: false });
    const supabase = getSupabaseAdmin();
    const targetUserId = await findUserIdByEmail(result.email);
    if (targetUserId && result.token) {
      const encrypted = await encryptMcpToken(result.token);
      await supabase
        .from("uk_chat_profiles")
        .upsert(encrypted ? { id: targetUserId, mcp_token: null, mcp_token_encrypted: encrypted } : { id: targetUserId, mcp_token: result.token }, { onConflict: "id" });
    }
    await writeAdminAuditLog({
      actorUserId: admin.user.id,
      actorEmail: admin.user.email ?? null,
      action: "admin.tokens.rotate",
      target: result.email,
      metadata: { tokenIssued: Boolean(result.tokenIssued) },
    });
    return json({ token: result.token });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token issuing failed";
    return json({ error: message }, 400);
  }
}

async function handleAdminOnboardUser(request: Request) {
  const auth = await ensureAdminOrBootstrap(request);
  if ("error" in auth) return auth.error;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = (await request.json()) as {
    email?: string;
    sendEmail?: boolean;
    token?: string;
    rotateToken?: boolean;
  };
  if (!body.email) return json({ error: "Email is required" }, 400);

  try {
    const result = await onboardUser({
      email: body.email,
      sendEmail: body.sendEmail,
      token: body.token,
      rotateToken: body.rotateToken,
    });
    await writeAdminAuditLog({
      actorUserId: auth.user?.id ?? null,
      actorEmail: auth.user?.email ?? null,
      action: "admin.users.onboard",
      target: result.email,
      metadata: {
        tokenIssued: Boolean(result.tokenIssued),
        emailSent: Boolean(result.emailSent),
        viaBootstrapSecret: auth.user === null,
      },
    });
    return json({
      message: "User onboarding completed",
      user: {
        email: result.email,
        status: "invited",
        hasToken: Boolean(result.token),
      },
      meta: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Onboarding failed";
    return json({ error: message }, 400);
  }
}

async function handleAdminCouncilSourceSettings(request: Request) {
  const admin = await ensureAdmin(request);
  if ("error" in admin) return admin.error;
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const supabase = getSupabaseAdmin();
  const settingKeys = [
    "council_national_source_preference",
    "council_national_whatgov_mps_table",
    "council_national_whatgov_debates_table",
  ];
  const { data, error } = await supabase.from("system_settings").select("key,value").in("key", settingKeys);
  if (error) return json({ error: error.message }, 400);

  const values = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ key?: string | null; value?: string | null }>) {
    if (!row.key) continue;
    values.set(row.key, row.value ?? "");
  }

  const envPreference = env("COUNCIL_NATIONAL_SOURCE_PREFERENCE")?.trim() || null;
  const envMpsTable = env("COUNCIL_NATIONAL_WHATGOV_MPS_TABLE")?.trim() || null;
  const envDebatesTable = env("COUNCIL_NATIONAL_WHATGOV_DEBATES_TABLE")?.trim() || null;

  return json({
    source: {
      preference: values.get("council_national_source_preference") ?? "whatgov-first",
      whatGovMpsTable: values.get("council_national_whatgov_mps_table") ?? "mps_uwhatgov",
      whatGovDebatesTable: values.get("council_national_whatgov_debates_table") ?? "casual_debates_uwhatgov",
    },
    envOverrides: {
      COUNCIL_NATIONAL_SOURCE_PREFERENCE: envPreference,
      COUNCIL_NATIONAL_WHATGOV_MPS_TABLE: envMpsTable,
      COUNCIL_NATIONAL_WHATGOV_DEBATES_TABLE: envDebatesTable,
    },
    effective: {
      preference: envPreference ?? values.get("council_national_source_preference") ?? "whatgov-first",
      whatGovMpsTable: envMpsTable ?? values.get("council_national_whatgov_mps_table") ?? "mps_uwhatgov",
      whatGovDebatesTable: envDebatesTable ?? values.get("council_national_whatgov_debates_table") ?? "casual_debates_uwhatgov",
    },
  });
}

async function handlePrivacyConsent(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const supabase = getSupabaseAdmin();
  await ensureProfileExists(user);

  if (request.method === "GET") {
    const { data, error } = await supabase
      .from("uk_chat_user_consents")
      .select("privacy_notice_version,ai_processing_acknowledged_at,sharing_warning_acknowledged_at,updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    return json({
      privacyNoticeVersion: data?.privacy_notice_version ?? null,
      aiProcessingAcknowledgedAt: data?.ai_processing_acknowledged_at ?? null,
      sharingWarningAcknowledgedAt: data?.sharing_warning_acknowledged_at ?? null,
      updatedAt: data?.updated_at ?? null,
      currentVersion: PRIVACY_NOTICE_VERSION,
    });
  }

  if (request.method === "PUT") {
    const body = (await request.json().catch(() => ({}))) as {
      acknowledgeAiProcessing?: boolean;
      acknowledgeSharingWarning?: boolean;
    };
    const now = new Date().toISOString();
    const patch = {
      user_id: user.id,
      privacy_notice_version: PRIVACY_NOTICE_VERSION,
      ai_processing_acknowledged_at: body.acknowledgeAiProcessing ? now : null,
      sharing_warning_acknowledged_at: body.acknowledgeSharingWarning ? now : null,
      updated_at: now,
    };
    const { data, error } = await supabase
      .from("uk_chat_user_consents")
      .upsert(patch, { onConflict: "user_id" })
      .select("privacy_notice_version,ai_processing_acknowledged_at,sharing_warning_acknowledged_at,updated_at")
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({
      privacyNoticeVersion: data.privacy_notice_version,
      aiProcessingAcknowledgedAt: data.ai_processing_acknowledged_at,
      sharingWarningAcknowledgedAt: data.sharing_warning_acknowledged_at,
      updatedAt: data.updated_at,
      currentVersion: PRIVACY_NOTICE_VERSION,
    });
  }

  return methodNotAllowed();
}

async function handleAccountProfile(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const supabase = getSupabaseAdmin();
  await ensureProfileExists(user);
  const claimedToken = await claimPendingMcpToken({ supabase, userId: user.id, email: user.email });
  const token = claimedToken ?? (await readProfileMcpToken({ supabase, userId: user.id, email: user.email }));
  const { data: consent } = await supabase
    .from("uk_chat_user_consents")
    .select("privacy_notice_version,ai_processing_acknowledged_at")
    .eq("user_id", user.id)
    .maybeSingle();
  return json({
    id: user.id,
    email: user.email ?? null,
    mcpToken: token,
    privacyConsent: {
      version: consent?.privacy_notice_version ?? null,
      aiProcessingAcknowledgedAt: consent?.ai_processing_acknowledged_at ?? null,
      currentVersion: PRIVACY_NOTICE_VERSION,
    },
  });
}

async function handleAccountExport(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const supabase = getSupabaseAdmin();
  const [profileRow, emailGateRow, conversationsRow, usageRow, councilsRow, consentRow] = await Promise.all([
    supabase.from("uk_chat_profiles").select("id,email,display_name,theme_preference,created_at").eq("id", user.id).maybeSingle(),
    user.email
      ? supabase.from("uk_chat_email_gate").select("email,invited_at,claimed_at").eq("email", user.email.toLowerCase()).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("uk_chat_conversations")
      .select(CONVERSATION_SELECT_FIELDS)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase.from("uk_chat_model_usage").select("model_id,usage_date,request_count,total_prompt_tokens,total_completion_tokens,total_tool_calls,created_at,updated_at").eq("user_id", user.id),
    supabase
      .from("uk_chat_councils")
      .select("id,conversation_id,issue,scope,resolved_geography,routing,agents,resolution,created_at,updated_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("uk_chat_user_consents")
      .select("privacy_notice_version,ai_processing_acknowledged_at,sharing_warning_acknowledged_at,created_at,updated_at")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (profileRow.error || conversationsRow.error || usageRow.error || councilsRow.error || consentRow.error) {
    return json({ error: "Unable to build export right now." }, 500);
  }

  const conversationIds = new Set((conversationsRow.data ?? []).map((conversation) => conversation.id));
  const { data: messages, error: messagesError } = await supabase
    .from("uk_chat_messages")
    .select("id,conversation_id,role,parts,created_at")
    .in("conversation_id", Array.from(conversationIds));
  if (messagesError) return json({ error: "Unable to build export right now." }, 500);

  const councilIds = new Set((councilsRow.data ?? []).map((council) => council.id));
  const councilTurnsRow =
    councilIds.size === 0
      ? { data: [], error: null }
      : await supabase
          .from("uk_chat_council_turns")
          .select("id,council_id,turns,source,created_at")
          .in("council_id", Array.from(councilIds));
  if (councilTurnsRow.error) return json({ error: "Unable to build export right now." }, 500);

  return json({
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email ?? null,
    },
    profile: profileRow.data ?? null,
    consent: consentRow.data ?? null,
    emailGate: emailGateRow.data ?? null,
    conversations: conversationsRow.data ?? [],
    messages: messages ?? [],
    modelUsage: usageRow.data ?? [],
    councils: councilsRow.data ?? [],
    councilTurns: councilTurnsRow.data ?? [],
  });
}

async function handleAccountDelete(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const supabase = getSupabaseAdmin();
  await writeAdminAuditLog({
    actorUserId: user.id,
    actorEmail: user.email ?? null,
    action: "account.delete.self",
    target: user.email ?? user.id,
  });
  const { error } = await supabase.auth.admin.deleteUser(user.id);
  if (error) return json({ error: "Failed to delete account." }, 500);
  return json({ success: true });
}

async function handleRetentionCron(request: Request) {
  const cronSecret = env("CRON_SECRET");
  if (!cronSecret) return json({ error: "CRON_SECRET is required" }, 500);
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== cronSecret) return json({ error: "Unauthorized" }, 401);

  const retentionDaysRaw = Number(env("DATA_RETENTION_DAYS") ?? DEFAULT_RETENTION_DAYS);
  const retentionDays = Number.isFinite(retentionDaysRaw) ? Math.max(30, Math.min(3650, Math.round(retentionDaysRaw))) : DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const supabase = getSupabaseAdmin();
  const { data: staleRows, error: staleError } = await supabase
    .from("uk_chat_conversations")
    .select("id")
    .lt("updated_at", cutoff)
    .limit(2000);
  if (staleError) return json({ error: staleError.message }, 500);
  const staleIds = (staleRows ?? []).map((row) => row.id);
  if (staleIds.length === 0) return json({ deletedCount: 0, retentionDays, cutoff });

  const { error: deleteError } = await supabase.from("uk_chat_conversations").delete().in("id", staleIds);
  if (deleteError) return json({ error: deleteError.message }, 500);
  return json({ deletedCount: staleIds.length, retentionDays, cutoff });
}

function methodNotAllowed() {
  return json({ error: "Method not allowed" }, 405);
}

async function routeRequest(request: Request) {
  const parts = routeParts(request);

  if (parts.length === 0) {
    if (request.method === "GET") return json({ ok: true });
    return methodNotAllowed();
  }

  if (parts[0] === "chat") {
    if (parts.length === 2 && parts[1] === "tools") {
      if (request.method !== "POST") return methodNotAllowed();
      return handleChatTools(request);
    }
    if (parts.length === 3 && parts[1] === "usage" && parts[2] === "all") {
      if (request.method !== "GET") return methodNotAllowed();
      return handleChatUsageAll(request);
    }
    if (parts.length === 2 && parts[1] === "usage") {
      if (request.method !== "GET") return methodNotAllowed();
      return handleChatUsage(request);
    }
    if (request.method !== "POST") return methodNotAllowed();
    return handleChat(request);
  }

  if (parts[0] === "council") {
    if (parts.length === 1 && request.method === "POST") return handleCouncilCreate(request);
    if (parts.length === 2 && parts[1] === "followup" && request.method === "POST") return handleCouncilFollowUp(request);
    if (parts.length === 2 && parts[1] === "infer-scope" && request.method === "POST") return handleCouncilInferScope(request);
    return json({ error: "Not found" }, 404);
  }

  if (parts[0] === "conversations") {
    if (parts.length === 1) return handleConversationsIndex(request);
    if (parts.length === 3 && parts[2] === "share") {
      if (request.method !== "POST" && request.method !== "PATCH") return methodNotAllowed();
      return handleConversationShare(request);
    }
    if (parts.length === 2) return handleConversationById(request);
    return json({ error: "Not found" }, 404);
  }

  if (parts[0] === "shared") {
    if (parts.length === 2 && request.method === "GET") return handleSharedConversation(request);
    return json({ error: "Not found" }, 404);
  }

  if (parts[0] === "auth") {
    if (parts[1] === "check-email") {
      if (request.method !== "POST") return methodNotAllowed();
      return handleCheckEmail(request);
    }
    if (parts[1] === "sign-in") {
      if (request.method !== "POST") return methodNotAllowed();
      return handleRecognizedSignIn(request);
    }
    if (parts[1] === "callback") {
      if (request.method !== "GET") return methodNotAllowed();
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  }

  if (parts[0] === "privacy" && parts[1] === "consent") {
    if (request.method !== "GET" && request.method !== "PUT") return methodNotAllowed();
    return handlePrivacyConsent(request);
  }

  if (parts[0] === "account") {
    if (parts.length === 2 && parts[1] === "profile" && request.method === "GET") return handleAccountProfile(request);
    if (parts.length === 2 && parts[1] === "export" && request.method === "GET") return handleAccountExport(request);
    if (parts.length === 1 && request.method === "DELETE") return handleAccountDelete(request);
    return json({ error: "Not found" }, 404);
  }

  if (parts[0] === "cron" && parts[1] === "data-retention") {
    if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed();
    return handleRetentionCron(request);
  }

  if (parts[0] === "admin") {
    if (parts[1] === "users") return handleAdminUsers(request);
    if (parts[1] === "tokens") return handleAdminTokens(request);
    if (parts[1] === "onboard-user") return handleAdminOnboardUser(request);
    if (parts[1] === "system-settings" && parts[2] === "council-source") return handleAdminCouncilSourceSettings(request);
    return json({ error: "Not found" }, 404);
  }

  return json({ error: "Not found" }, 404);
}

export async function GET(request: Request) {
  return routeRequest(request);
}

export async function POST(request: Request) {
  return routeRequest(request);
}

export async function PATCH(request: Request) {
  return routeRequest(request);
}

export async function PUT(request: Request) {
  return routeRequest(request);
}

export async function DELETE(request: Request) {
  return routeRequest(request);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    },
  });
}
