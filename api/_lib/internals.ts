import { convertToModelMessages, generateText, jsonSchema, stepCountIs, streamText } from "ai";
import type { Env } from "../env.js";
import { getSupabaseAdmin, json } from "./server.js";
import { decryptMcpToken, encryptMcpToken } from "./crypto.js";
import { logError, logWarn } from "./logger.js";
import { shouldClearPendingMcpToken } from "./mcp-token-recovery.js";
import { compactMessagesForModel as compactUiMessagesForModel } from "./context.js";
import { compactToolOutputForModel, sanitizeToolName } from "./message-utils.js";
import { stripToolContextEchoes } from "../../src/shared/text-sanitize.js";
import { AUTO_CHAT_TITLE_REGEX } from "../../src/shared/chat-constants.js";
import { isRecord } from "../../src/shared/type-guards.js";
import { loadMcpToolsWithFallback as loadMcpToolsWithFallbackFromLib } from "./mcp.js";
import type { McpAttempt } from "./mcp.js";
export type { McpAttempt } from "./mcp.js";
export type { McpCandidate } from "./mcp.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PersistedMessagePart = { type: string; [key: string]: unknown };
export type PersistedDocumentPart = {
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
export type ToolCatalogItem = {
  name: string;
  description: string;
  category: "data" | "analysis" | "system";
  score: number;
  recommended: boolean;
};
export type ArtifactContextItem = {
  id: string;
  conversationId?: string;
  messageId?: string;
  toolName: string;
  title: string;
  data: unknown;
  chartSpec?: unknown;
};
export type CompactModelMessage = { role: "user" | "assistant" | "system"; content: string };

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
type IncomingArtifactContextItem = {
  id?: unknown;
  conversationId?: unknown;
  messageId?: unknown;
  toolName?: unknown;
  title?: unknown;
  data?: unknown;
  chartSpec?: unknown;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONVERSATION_SELECT_FIELDS = "id,title,starred,is_public,share_token,created_at,updated_at";
export const SHARED_CONVERSATION_SELECT_FIELDS = "id,title,created_at,updated_at,is_public,share_token,share_expires_at";
export const PRIVACY_NOTICE_VERSION = "2026-03-30";
export const DEFAULT_SHARE_EXPIRY_DAYS = 30;
export const DEFAULT_RETENTION_DAYS = 365;
export const DEFAULT_SOFT_DELETE_GRACE_DAYS = 30;
export const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 90;
export const AUTO_CHAT_TITLE_MAX_LENGTH = 72;
export { AUTO_CHAT_TITLE_REGEX as AUTO_CHAT_TITLE_DEFAULT_REGEX };
export const AUTO_CHAT_TITLE_MODEL = "google/gemini-2.5-flash-lite";
export const UK_POSTCODE_REGEX = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
export const MAX_CHAT_DOCUMENT_COUNT = 8;
export const MAX_CHAT_DOCUMENT_TEXT_CHARS = 30_000;
export const MAX_CHAT_DOCUMENT_CONTEXT_CHARS = 90_000;
export const MAX_ARTIFACT_CONTEXT_ITEMS = 5;
export const MAX_ARTIFACT_CONTEXT_CHARS = 16_000;
export const ARTIFACT_TOOL_ALLOWLIST = new Set([
  "ons_fetchobservations",
  "nomis_fetchtable",
  "police_fetchcrimes",
  "ea_flood",
  "postcodes_lookup",
  "council_deliberation",
  "create_chart",
]);

export {
  CREATE_CHART_INPUT_SCHEMA,
  MODELS_NEEDING_SCHEMA_PROJECTION,
  PROVIDER_TOOL_NAME_MAX_LENGTH,
  PROVIDER_TOOL_NAME_PATTERN,
  WEAK_MODEL_TOOL_SCHEMA_PROJECTION_RULES,
  buildProviderSafeTools,
  inferArrayItemsFromPath,
  inferTupleItemsSchema,
  isSchemaWrapper,
  normalizeToolSchemaInPlace,
  normalizeToolSchemas,
  projectToolSchemaForRule,
  projectToolSchemasForModel,
  toProviderSafeToolName,
} from "./tool-normalization.js";
export type { ToolSchemaProjectionRule } from "./tool-normalization.js";

// compactCreateChart constants
const MAX_CREATE_CHART_ROWS = 120;
const MAX_CREATE_CHART_COLUMNS = 14;
const MAX_CREATE_CHART_STRING_LENGTH = 220;

export {
  buildAssistantPartsFromFinishEvent,
  collectToolPartsFromMessages,
  compactMessagesForModel,
  compactToolOutputForModel,
  ensureToolResultsPaired,
  extractPartsFromResponseMessage,
  hasAnyToolOutput,
  hasMeaningfulTextPart,
  isPersistedToolPart,
  mergeToolCallsAndResultsIntoParts,
  persistedToolPartSignature,
  sanitizeToolName,
  stringifyPersistedToolPayload,
} from "./message-utils.js";

// ---------------------------------------------------------------------------
// Pure utility functions (no env needed)
// ---------------------------------------------------------------------------

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function coerceString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseJsonSafely(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function unwrapQuotedField(value: string): string {
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

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated for context window]`;
}

export function parseHttpUrl(value: string | undefined | null): URL | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function getAuthRedirectBase(request: Request, env: Env): string {
  const requestUrl = new URL(request.url);
  const configuredAppUrl = parseHttpUrl(env.APP_URL?.trim());
  const originHeader = parseHttpUrl(request.headers.get("origin"));
  const refererHeader = parseHttpUrl(request.headers.get("referer"));
  const browserOrigin = originHeader ?? refererHeader;

  if (isLoopbackHostname(requestUrl.hostname)) {
    if (browserOrigin && isLoopbackHostname(browserOrigin.hostname)) return browserOrigin.origin;
    if (configuredAppUrl && isLoopbackHostname(configuredAppUrl.hostname)) return configuredAppUrl.origin;
    return "http://localhost:5173";
  }

  return configuredAppUrl?.origin ?? requestUrl.origin;
}

export function getEmailDomain(email: string): string | null {
  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0 || atIndex >= email.length - 1) return null;
  return email.slice(atIndex + 1).toLowerCase();
}

export function getAllowedEmailDomains(env: Env): Set<string> {
  const raw = env.ALLOWED_EMAIL_DOMAINS?.trim() ?? "";
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowedEmailDomain(email: string, env: Env): boolean {
  const domain = getEmailDomain(email);
  if (!domain) return false;
  return getAllowedEmailDomains(env).has(domain);
}

export function isDevBypassEnabled(): boolean {
  // Workers have no process.env; always return false.
  return false;
}

export function isProviderInvalidRequestError(error: unknown): boolean {
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

export function isProviderTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as {
    statusCode?: number;
    cause?: { statusCode?: number; message?: string };
    message?: string;
  };
  if ([408, 504, 524].includes(maybeError.statusCode ?? -1)) return true;
  if ([408, 504, 524].includes(maybeError.cause?.statusCode ?? -1)) return true;
  const message = `${maybeError.message ?? ""} ${maybeError.cause?.message ?? ""}`.toLowerCase();
  return message.includes("timeout") || message.includes("timed out") || message.includes("deadline exceeded");
}

export function getOpenRouterFallbackModels(modelId: string): string[] {
  switch (modelId) {
    case "flash":
      return ["google/gemini-2.5-flash-lite", "google/gemini-2.5-flash"];
    case "pro":
      return ["google/gemini-2.5-pro", "google/gemini-2.5-flash"];
    default:
      return [];
  }
}


export function isMcpUnauthorized(attempts: McpAttempt[]): boolean {
  return attempts.some((attempt) => {
    const message = attempt.error.toLowerCase();
    return message.includes("401") || message.includes("unauthorized");
  });
}


// ---------------------------------------------------------------------------
// Tool name / share helpers
// ---------------------------------------------------------------------------


export function createShareToken() {
  return `share_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function buildShareExpiryIso(days = DEFAULT_SHARE_EXPIRY_DAYS): string {
  const millis = Math.max(1, days) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + millis).toISOString();
}


// ---------------------------------------------------------------------------
// Tool logging
// ---------------------------------------------------------------------------

export function logToolSequenceForRequest(params: {
  event: unknown;
  conversationId?: string | null;
  modelId: string;
  providerModel: string;
  quantTelemetry?: Record<string, unknown>;
}) {
  const { event, conversationId, modelId, providerModel, quantTelemetry } = params;
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

  const CREATE_CHART_TOOL_NAME = "create_chart";
  const firstTool = sequence[0]?.toolName ?? null;
  const calledCreateChartFirst = firstTool === CREATE_CHART_TOOL_NAME;
  const finishReason = typeof event.finishReason === "string" ? event.finishReason : null;
  const stepCount = Array.isArray(event.steps) ? event.steps.length : null;
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
    finishReason,
    stepCount,
    firstTool,
    calledCreateChartFirst,
    createChartGuardrailTriggered,
    quantTelemetry: quantTelemetry ?? null,
    sequence,
  });
}

// ---------------------------------------------------------------------------
// Profile / MCP token helpers
// ---------------------------------------------------------------------------

export async function ensureProfileExists(user: { id: string; email?: string | null }, env: Env) {
  const supabase = getSupabaseAdmin(env);
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

export async function readProfileMcpToken(params: {
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
  await supabase.from("uk_chat_profiles").update({ mcp_token_encrypted: encrypted, mcp_token: null }).eq("id", userId);
  return plainToken;
}

export async function claimPendingMcpToken(params: {
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
  const profilePatch = { mcp_token: null, mcp_token_encrypted: encrypted };

  await supabase.from("uk_chat_profiles").update(profilePatch).eq("id", userId);
  await supabase.from("uk_chat_email_gate").update({ claimed_at: new Date().toISOString() }).eq("email", normalizedEmail);
  return pendingToken;
}

// ---------------------------------------------------------------------------
// Usage tracking — extracted to ./usage.ts, re-exported below
// ---------------------------------------------------------------------------

export {
  approachingThreshold,
  getModelUsageStatus,
  reserveModelUsageSlot,
  utcDateStamp,
} from "./usage.js";

// ---------------------------------------------------------------------------
// Tool catalog
// ---------------------------------------------------------------------------

export function classifyTool(name: string, description: string): { category: ToolCatalogItem["category"]; baseScore: number } {
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

export function buildToolCatalog(tools: Record<string, unknown>, query: string) {
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

// ---------------------------------------------------------------------------
// User text extraction
// ---------------------------------------------------------------------------

export function extractLatestUserText(messages: Array<{ role?: string; parts?: unknown[] }> | undefined): string {
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

// ---------------------------------------------------------------------------
// Auto chat title
// ---------------------------------------------------------------------------

export function isAutoGeneratedConversationTitle(title?: string | null): boolean {
  if (!title) return true;
  return AUTO_CHAT_TITLE_REGEX.test(title.trim());
}

export function sanitizeAutoChatTitle(raw: string): string | null {
  const withoutPrefix = raw.replace(/^title\s*:\s*/i, "");
  const normalized = withoutPrefix.replace(/\s+/g, " ").trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!normalized) return null;
  if (normalized.length <= AUTO_CHAT_TITLE_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, AUTO_CHAT_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

export async function generateAutoChatTitleFromFirstMessage(
  message: string,
  model: unknown,
): Promise<string | null> {
  const cleanedMessage = message.replace(/\s+/g, " ").trim();
  if (!cleanedMessage) return null;
  try {
    const result = await generateText({
      model: model as Parameters<typeof generateText>[0]["model"],
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

// ---------------------------------------------------------------------------
// Artifact helpers
// ---------------------------------------------------------------------------

export function normalizeArtifactToolName(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function hasChartLikeShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (Array.isArray(value.series) || Array.isArray(value.datasets) || Array.isArray(value.points)) return true;
  if (isRecord(value.chart) || isRecord(value.plot) || isRecord(value.echarts) || isRecord(value.vega)) return true;
  return false;
}

export function isArtifactCandidate(toolName: string, data: unknown): boolean {
  const normalized = normalizeArtifactToolName(toolName).toLowerCase();
  if (ARTIFACT_TOOL_ALLOWLIST.has(normalized)) return true;
  return hasChartLikeShape(data);
}

export function sanitizeArtifactContext(input: unknown): ArtifactContextItem[] {
  if (!Array.isArray(input)) return [];
  const items: ArtifactContextItem[] = [];
  for (const raw of input.slice(0, MAX_ARTIFACT_CONTEXT_ITEMS)) {
    if (!isRecord(raw)) continue;
    const candidate = raw as IncomingArtifactContextItem;
    const toolName = coerceString(candidate.toolName).trim();
    if (!toolName) continue;
    const title = coerceString(candidate.title).trim() || `Artifact: ${toolName}`;
    const id = coerceString(candidate.id).trim() || `${normalizeArtifactToolName(toolName)}:${items.length}`;
    const conversationId = coerceString(candidate.conversationId).trim() || undefined;
    const messageId = coerceString(candidate.messageId).trim() || undefined;
    const chartSpec = isRecord(candidate.chartSpec) ? candidate.chartSpec : undefined;
    items.push({
      id,
      conversationId,
      messageId,
      toolName,
      title: title.slice(0, 180),
      data: compactToolOutputForModel(candidate.data),
      chartSpec: chartSpec ? compactToolOutputForModel(chartSpec) : undefined,
    });
  }
  return items;
}

export function summarizeArtifactContext(items: ArtifactContextItem[]): string {
  if (items.length === 0) return "";
  const lines: string[] = [
    "ARTIFACT CONTEXT",
    "The user pinned artifacts from prior chats. Treat this as supplemental evidence, and reconcile with fresh tool outputs when they differ.",
    "",
  ];
  for (const [index, artifact] of items.entries()) {
    lines.push(`Artifact ${index + 1}: ${artifact.title}`);
    lines.push(`Tool: ${artifact.toolName}`);
    if (artifact.conversationId) lines.push(`Source conversation: ${artifact.conversationId}`);
    if (artifact.messageId) lines.push(`Source message: ${artifact.messageId}`);
    if (artifact.chartSpec) {
      lines.push(`Chart spec: ${JSON.stringify(compactToolOutputForModel(artifact.chartSpec)).slice(0, 1200)}`);
    }
    lines.push(`Data summary: ${JSON.stringify(compactToolOutputForModel(artifact.data)).slice(0, 2400)}`);
    lines.push("");
  }
  return lines.join("\n").slice(0, MAX_ARTIFACT_CONTEXT_CHARS);
}

// ---------------------------------------------------------------------------
// Document handling
// ---------------------------------------------------------------------------

export function sanitizeIncomingDocuments(input: unknown): PersistedDocumentPart[] {
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

export function buildDocumentContextFromParts(parts: PersistedMessagePart[]): string {
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

export async function loadConversationDocumentContext({
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

// ---------------------------------------------------------------------------
// Artifact extraction from messages
// ---------------------------------------------------------------------------

export function extractArtifactsFromMessages(
  messages: Array<{ id: string; conversation_id?: string; parts: unknown[]; created_at?: string }>,
  conversationId?: string,
) {
  const artifacts: Array<{
    id: string;
    toolName: string;
    title: string;
    data: unknown;
    chartSpec?: unknown;
    conversationId?: string;
    messageId?: string;
    createdAt?: string;
  }> = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (!isRecord(part) || typeof part.type !== "string" || !part.type.startsWith("tool-")) continue;
      if (part.state !== "output-available" || !("output" in part) || part.output == null) continue;
      const toolName = part.type.replace("tool-", "");
      if (!isArtifactCandidate(toolName, part.output)) continue;
      const normalizedToolName = normalizeArtifactToolName(toolName);
      const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : `part-${artifacts.length}`;
      const chartSpec = normalizedToolName === "create_chart" && isRecord(part.output) ? part.output : undefined;
      artifacts.push({
        id: `${message.id}:${normalizedToolName}:${toolCallId}`,
        toolName: normalizedToolName,
        title: `Chart: ${normalizedToolName}`,
        data: compactToolOutputForModel(part.output),
        chartSpec: chartSpec ? compactToolOutputForModel(chartSpec) : undefined,
        conversationId: conversationId ?? message.conversation_id,
        messageId: message.id,
        createdAt: message.created_at,
      });
    }
  }
  return artifacts;
}

// ---------------------------------------------------------------------------
// Chart spec normalization
// ---------------------------------------------------------------------------

export function normalizeChartFieldList(value: unknown, maxItems: number): string[] {
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

export function normalizeChartDataRows(value: unknown): Array<Record<string, unknown>> {
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

export function normalizeCreateChartSpec(input: unknown): unknown {
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

export function compactCreateChartSpec(input: unknown): unknown {
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

// ---------------------------------------------------------------------------
// MCP tool loading (needs env for MCP_SERVER_URL)
// ---------------------------------------------------------------------------

export async function loadAuthorizedMcpTools({
  supabase,
  user,
  mcpToken,
  conversationId,
  env,
}: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  user: { id: string; email?: string | null };
  mcpToken?: string | null;
  conversationId?: string | null;
  env: Env;
}): Promise<{ tools: Record<string, unknown> } | { response: Response }> {
  let token = mcpToken ?? (await readProfileMcpToken({ supabase, userId: user.id, email: user.email }));
  if (!token) {
    token = await claimPendingMcpToken({ supabase, userId: user.id, email: user.email });
  }
  if (!token) return { response: json({ error: "Missing MCP token" }, 400) };

  const normalizedEmail = user.email?.trim().toLowerCase();
  const attemptedTokens = new Set<string>([token]);
  const configuredMcpUrl = env.MCP_SERVER_URL ?? "https://mcp.explorethekingdom.co.uk/sse";

  const loadMcpToolsWithFallback = async (url: string, tok: string) => {
    return (await loadMcpToolsWithFallbackFromLib(url, tok)) as {
      tools: Record<string, unknown> | null;
      connectedVia: { type: string; url: string } | null;
      attempts: McpAttempt[];
    };
  };

  let mcpLoad = await loadMcpToolsWithFallback(configuredMcpUrl, token);
  if (!mcpLoad.tools && isMcpUnauthorized(mcpLoad.attempts)) {
    if (normalizedEmail) {
      const { data: gate } = await supabase
        .from("uk_chat_email_gate")
        .select("pending_mcp_token")
        .eq("email", normalizedEmail)
        .maybeSingle();
      const pendingToken = gate?.pending_mcp_token as string | null | undefined;

      if (pendingToken && pendingToken !== token) {
        attemptedTokens.add(pendingToken);
        const retryLoad = await loadMcpToolsWithFallback(configuredMcpUrl, pendingToken);
        if (retryLoad.tools) {
          token = pendingToken;
          mcpLoad = retryLoad;
          const encrypted = await encryptMcpToken(pendingToken);
          await supabase
            .from("uk_chat_profiles")
            .update({ mcp_token: null, mcp_token_encrypted: encrypted })
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
      if (normalizedEmail) {
        const { data: gate } = await supabase
          .from("uk_chat_email_gate")
          .select("pending_mcp_token")
          .eq("email", normalizedEmail)
          .maybeSingle();
        const gateToken = typeof gate?.pending_mcp_token === "string" ? gate.pending_mcp_token : null;
        if (shouldClearPendingMcpToken({ pendingToken: gateToken, attemptedTokens })) {
          await supabase.from("uk_chat_email_gate").update({ pending_mcp_token: null }).eq("email", normalizedEmail);
        }
      }
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

// ---------------------------------------------------------------------------
// Admin helpers (need env for getSupabaseAdmin)
// ---------------------------------------------------------------------------

export async function getProfileTokenMapByEmail(emails: string[], env: Env) {
  const supabase = getSupabaseAdmin(env);
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

export async function findUserIdByEmail(email: string, env: Env): Promise<string | null> {
  const admin = getSupabaseAdmin(env);
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
