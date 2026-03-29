import { generateText, jsonSchema, stepCountIs, streamText } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { waitUntil } from "@vercel/functions";
import { CHAT_SUPPORT_CONTACT, getChatModelConfig } from "./_lib/chat-models.js";
import { onboardUser } from "./_lib/onboarding.js";
import { ensureAdmin, ensureAdminOrBootstrap, getSupabaseAdmin, getUserFromRequest, json } from "./_lib/server.js";
import { getSystemPrompt } from "./_lib/system-prompt.js";

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

const openrouter = createOpenRouter({
  apiKey: env("OPENROUTER_API_KEY"),
});

const AUTO_CHAT_TITLE_MAX_LENGTH = 72;
const AUTO_CHAT_TITLE_DEFAULT_REGEX = /^(new chat(?:\s+\d+)?|untitled)$/i;
const AUTO_CHAT_TITLE_MODEL = "google/gemini-2.5-flash-lite";

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

function compactCreateChartSpec(input: unknown): unknown {
  if (!isRecord(input)) return input;

  const compactedData = Array.isArray(input.data)
    ? input.data
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
    : input.data;

  const yFields = Array.isArray(input.yFields)
    ? input.yFields.filter((item): item is string => typeof item === "string").slice(0, 6)
    : input.yFields;
  const sources = Array.isArray(input.sources)
    ? input.sources.filter((item): item is string => typeof item === "string").slice(0, 8)
    : input.sources;

  return {
    ...input,
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
    if (responseParts.length > 0) return responseParts;
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
    .select("request_count")
    .eq("user_id", userId)
    .eq("model_id", modelId)
    .eq("usage_date", usageDate)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message, used: 0, remaining: 0, approaching: false, reached: false };
  const used = data?.request_count ?? 0;
  const remaining = Math.max(0, dailyLimit - used);
  const reached = remaining <= 0;
  const approaching = !reached && remaining <= approachingThreshold(dailyLimit);
  return { ok: true as const, error: null, used, remaining, approaching, reached };
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
    console.warn("[api/chat] Failed to generate auto chat title", {
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
  const { data: profile } = await supabase.from("uk_chat_profiles").select("mcp_token").eq("id", user.id).single();
  let token = mcpToken ?? profile?.mcp_token;
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
          await supabase.from("uk_chat_profiles").update({ mcp_token: pendingToken }).eq("id", user.id);
          console.warn("[api/chat] Recovered from unauthorized MCP token using pending token", {
            userId: user.id,
            conversationId: conversationId ?? null,
          });
        } else {
          console.error("[api/chat] Pending MCP token retry failed", {
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
      await supabase.from("uk_chat_profiles").update({ mcp_token: null }).eq("id", user.id);
      console.error("[api/chat] MCP token unauthorized after recovery attempts", {
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
    console.error("[api/chat] MCP tool connection failed", {
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
    banner,
  });
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
  const tools = toolLoad.tools;
  const latestUserQuery = extractLatestUserText(body.messages);
  const scopedTools = {
    ...selectToolsForChat(tools, latestUserQuery, 18),
    [CREATE_CHART_TOOL_NAME]: createSyntheticChartTool(),
  };

  const { normalizedTools, normalizedToolNames } = normalizeToolSchemas(scopedTools);
  const { safeTools, safeToOriginal, renamedPairs } = buildProviderSafeTools(normalizedTools);
  if (normalizedToolNames.length > 0) {
    console.warn("[api/chat] Normalized Gemini-incompatible MCP schemas", {
      normalizedCount: normalizedToolNames.length,
      normalizedToolNames,
    });
  }
  console.warn("[api/chat] Scoped tool catalog for request", {
    totalTools: Object.keys(tools).length,
    selectedTools: Object.keys(scopedTools).length,
    query: latestUserQuery.slice(0, 180),
  });
  if (renamedPairs.length > 0) {
    console.warn("[api/chat] Remapped tool names for provider compatibility", {
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
      console.error("[api/chat] Failed to persist user message", {
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
          console.warn("[api/chat] Failed to persist auto chat title", {
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
  const systemPrompt = documentContext ? `${getSystemPrompt()}\n\n${documentContext}` : getSystemPrompt();
  const compactedMessages = compactMessagesForModel(body.messages ?? []);
  if (Array.isArray(body.messages) && compactedMessages.length !== body.messages.length) {
    console.warn("[api/chat] Compacted message history for model context", {
      originalCount: body.messages.length,
      compactedCount: compactedMessages.length,
    });
  }
  const compactedChars = compactedMessages.reduce((sum, message) => sum + message.content.length, 0);
  if (compactedChars > 40_000) {
    console.warn("[api/chat] Compacted message payload is still large", {
      compactedCount: compactedMessages.length,
      compactedChars,
    });
  }

  const onAssistantFinish: Parameters<typeof streamText>[0]["onFinish"] = async (event) => {
    const persistPromise = (async () => {
      const assistantParts = buildAssistantPartsFromFinishEvent(event, (name) => safeToOriginal.get(name) ?? name);
      const { error: assistantInsertError } = await supabase.from("uk_chat_messages").insert({
        conversation_id: body.conversationId!,
        role: "assistant",
        parts: assistantParts,
      });
      if (assistantInsertError) {
        console.error("[api/chat] Failed to persist assistant message", {
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
        console.error("[api/chat] Failed to update conversation timestamp", {
          conversationId: body.conversationId,
          userId: user.id,
          error: updateConversationError.message,
          code: updateConversationError.code ?? null,
        });
      }
    })();

    try {
      waitUntil(persistPromise);
    } catch {
      // Local dev can run outside a waitUntil-capable runtime.
    }
    await persistPromise;
  };

  const fallbackModels = getOpenRouterFallbackModels(selectedModel.id);
  const tryStream = (options: { includeFallbackModels: boolean; includeTools: boolean }) =>
    streamText({
      model: openrouter.chat(selectedModel.providerModel, {
        extraBody: options.includeFallbackModels && fallbackModels.length > 0 ? { models: fallbackModels } : undefined,
      }),
      messages: compactedMessages,
      tools: options.includeTools ? (safeTools as Parameters<typeof streamText>[0]["tools"]) : undefined,
      stopWhen: stepCountIs(10),
      system: systemPrompt,
      onFinish: onAssistantFinish,
    });

  let result: ReturnType<typeof streamText>;
  try {
    result = tryStream({ includeFallbackModels: true, includeTools: true });
  } catch (error) {
    if (!isProviderInvalidRequestError(error)) throw error;
    console.warn("[api/chat] Provider rejected request, retrying without fallback model chain", {
      modelId: selectedModel.id,
      providerModel: selectedModel.providerModel,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      result = tryStream({ includeFallbackModels: false, includeTools: true });
    } catch (retryError) {
      if (!isProviderInvalidRequestError(retryError)) throw retryError;
      console.warn("[api/chat] Provider still rejected request, retrying without tools", {
        modelId: selectedModel.id,
        providerModel: selectedModel.providerModel,
        error: retryError instanceof Error ? retryError.message : String(retryError),
      });
      result = tryStream({ includeFallbackModels: false, includeTools: false });
    }
  }

  return result.toUIMessageStreamResponse();
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
      .select("id,title,starred,is_public,share_token,created_at,updated_at")
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
      supabase.from("uk_chat_conversations").insert(payload).select("id,title,starred,is_public,share_token,created_at,updated_at").single();

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
      .select("id,title,starred,is_public,share_token,created_at,updated_at")
      .single();
    if (error) return json({ error: error.message }, 400);
    return json(data);
  }

  if (request.method === "GET") {
    const { data: conversation, error: conversationError } = await supabase
      .from("uk_chat_conversations")
      .select("id,title,starred,is_public,share_token,created_at,updated_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (conversationError) {
      console.warn("[api/conversations/:id] lookup failed", {
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

  const shareToken = conversation.share_token ?? createShareToken();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("uk_chat_conversations")
    .update({
      is_public: true,
      share_token: shareToken,
      shared_at: now,
      updated_at: now,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id,title,starred,is_public,share_token,created_at,updated_at")
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
    .select("id,title,created_at,updated_at,is_public,share_token")
    .eq("share_token", token)
    .eq("is_public", true)
    .single();
  if (conversationError || !conversation) {
    return json({ error: "Shared conversation not found" }, 404);
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
      const { data: profiles } = await supabase.from("uk_chat_profiles").select("id,mcp_token").in("id", matchingIds);
      for (const profile of profiles ?? []) {
        const email = idToEmail.get(profile.id);
        if (!email) continue;
        out.set(email, profile.mcp_token);
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
      await supabase.from("uk_chat_profiles").upsert({ id: targetUserId, mcp_token: result.token }, { onConflict: "id" });
    }
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
    if (parts.length === 2 && parts[1] === "usage") {
      if (request.method !== "GET") return methodNotAllowed();
      return handleChatUsage(request);
    }
    if (request.method !== "POST") return methodNotAllowed();
    return handleChat(request);
  }

  if (parts[0] === "conversations") {
    if (parts.length === 1) return handleConversationsIndex(request);
    if (parts.length === 3 && parts[2] === "share") {
      if (request.method !== "POST") return methodNotAllowed();
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

  if (parts[0] === "admin") {
    if (parts[1] === "users") return handleAdminUsers(request);
    if (parts[1] === "tokens") return handleAdminTokens(request);
    if (parts[1] === "onboard-user") return handleAdminOnboardUser(request);
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

export async function DELETE(request: Request) {
  return routeRequest(request);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET,POST,PATCH,DELETE,OPTIONS",
    },
  });
}
