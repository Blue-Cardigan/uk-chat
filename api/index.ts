import { convertToModelMessages, streamText } from "ai";
import { google } from "@ai-sdk/google";
import { createMCPClient } from "@ai-sdk/mcp";
import { waitUntil } from "@vercel/functions";
import { onboardUser } from "./_lib/onboarding.js";
import { ensureAdmin, ensureAdminOrBootstrap, getSupabaseAdmin, getUserFromRequest, json } from "./_lib/server.js";

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
type McpTransportType = "sse" | "http";
type McpCandidate = { type: McpTransportType; url: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  const attempts: Array<{ type: McpTransportType; url: string; error: string }> = [];

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

function normalizeGeminiSchemaInPlace(node: unknown, path: string[] = []): boolean {
  let changed = false;

  if (Array.isArray(node)) {
    for (const item of node) {
      if (normalizeGeminiSchemaInPlace(item, path)) changed = true;
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
    if (normalizeGeminiSchemaInPlace(value, [...path, key])) changed = true;
  }

  return changed;
}

function normalizeGeminiTools<T extends Record<string, unknown>>(tools: T): {
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
    const schemaKey = isRecord(toolDefinition.inputSchema)
      ? "inputSchema"
      : isRecord(toolDefinition.parameters)
        ? "parameters"
        : null;
    if (!schemaKey) {
      entries.push([toolName, toolDefinition]);
      continue;
    }

    const schemaValue = toolDefinition[schemaKey];
    let schemaCopy: unknown = schemaValue;
    try {
      schemaCopy = structuredClone(schemaValue);
    } catch {
      // Keep original schema object if clone fails.
    }

    const toolCopy: Record<string, unknown> = { ...toolDefinition, [schemaKey]: schemaCopy };
    const changed = normalizeGeminiSchemaInPlace(toolCopy[schemaKey], [toolName, schemaKey]);
    if (changed) normalizedToolNames.push(toolName);
    entries.push([toolName, toolCopy]);
  }

  return { normalizedTools: Object.fromEntries(entries) as T, normalizedToolNames };
}

function sanitizeToolName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const normalized = name.trim();
  if (!normalized) return null;
  return normalized.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function createShareToken() {
  return `share_${crypto.randomUUID().replace(/-/g, "")}`;
}

function extractPartsFromResponseMessage(message: unknown): PersistedMessagePart[] {
  if (!isRecord(message)) return [];

  const directParts = message.parts;
  if (Array.isArray(directParts)) {
    return directParts.filter((part): part is PersistedMessagePart => isRecord(part) && typeof part.type === "string");
  }

  const content = message.content;
  if (!Array.isArray(content)) return [];

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
      const toolName = sanitizeToolName(segment.toolName);
      if (!toolName) continue;
      parts.push({
        type: `tool-${toolName}`,
        state: "input-available",
        input: segment.input ?? null,
        toolCallId: segment.toolCallId ?? null,
      });
      continue;
    }

    if (segment.type === "tool-result") {
      const toolName = sanitizeToolName(segment.toolName);
      if (!toolName) continue;
      parts.push({
        type: `tool-${toolName}`,
        state: "output-available",
        output: segment.output ?? null,
        toolCallId: segment.toolCallId ?? null,
      });
      continue;
    }

    parts.push(segment as PersistedMessagePart);
  }
  return parts;
}

function buildAssistantPartsFromFinishEvent(event: unknown): PersistedMessagePart[] {
  if (!isRecord(event)) return [{ type: "text", text: "" }];

  const response = event.response;
  if (isRecord(response) && Array.isArray(response.messages)) {
    const assistantResponseMessage = [...response.messages]
      .reverse()
      .find((message) => isRecord(message) && message.role === "assistant");
    const responseParts = extractPartsFromResponseMessage(assistantResponseMessage);
    if (responseParts.length > 0) return responseParts;
  }

  const text = typeof event.text === "string" ? event.text : "";
  const fallbackParts: PersistedMessagePart[] = [{ type: "text", text }];
  if (typeof event.reasoning === "string" && event.reasoning.trim()) {
    fallbackParts.push({ type: "reasoning", text: event.reasoning });
  }

  const toolCalls = Array.isArray(event.toolCalls) ? event.toolCalls : [];
  for (const call of toolCalls) {
    if (!isRecord(call)) continue;
    const toolName = sanitizeToolName(call.toolName);
    if (!toolName) continue;
    fallbackParts.push({
      type: `tool-${toolName}`,
      state: "input-available",
      input: call.input ?? null,
      toolCallId: call.toolCallId ?? null,
    });
  }

  const toolResults = Array.isArray(event.toolResults) ? event.toolResults : [];
  for (const result of toolResults) {
    if (!isRecord(result)) continue;
    const toolName = sanitizeToolName(result.toolName);
    if (!toolName) continue;
    fallbackParts.push({
      type: `tool-${toolName}`,
      state: "output-available",
      output: result.output ?? null,
      toolCallId: result.toolCallId ?? null,
    });
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

async function handleChat(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const body = (await request.json()) as {
    messages?: Array<{ role?: string; parts?: unknown[] }>;
    mcpToken?: string | null;
    conversationId?: string | null;
  };
  const supabase = getSupabaseAdmin();
  const { data: profile } = await supabase.from("uk_chat_profiles").select("mcp_token").eq("id", user.id).single();
  const token = body.mcpToken ?? profile?.mcp_token;
  if (!token) return json({ error: "Missing MCP token" }, 400);
  if (!body.conversationId) return json({ error: "Missing conversationId" }, 400);
  const { data: conversation } = await supabase
    .from("uk_chat_conversations")
    .select("id")
    .eq("id", body.conversationId)
    .eq("user_id", user.id)
    .single();
  if (!conversation) return json({ error: "Conversation not found" }, 404);

  const configuredMcpUrl = env("MCP_SERVER_URL") ?? "https://mcp.explorethekingdom.co.uk/sse";
  const mcpLoad = await loadMcpToolsWithFallback(configuredMcpUrl, token);
  if (!mcpLoad.tools) {
    console.error("[api/chat] MCP tool connection failed", {
      userId: user.id,
      conversationId: body.conversationId,
      configuredMcpUrl,
      attempts: mcpLoad.attempts,
    });
    const details = mcpLoad.attempts.map((attempt) => `${attempt.type}:${attempt.url} -> ${attempt.error}`).join(" | ");
    return json({ error: `Unable to connect to MCP tools (${details || "no attempts"}).` }, 502);
  }
  const tools = mcpLoad.tools;

  const { normalizedTools, normalizedToolNames } = normalizeGeminiTools(tools);
  if (normalizedToolNames.length > 0) {
    console.warn("[api/chat] Normalized Gemini-incompatible MCP schemas", {
      normalizedCount: normalizedToolNames.length,
      normalizedToolNames,
    });
  }

  const latestUserMessage = [...(body.messages ?? [])].reverse().find((message) => message.role === "user");
  if (latestUserMessage) {
    const { error: insertUserError } = await supabase.from("uk_chat_messages").insert({
      conversation_id: body.conversationId,
      role: "user",
      parts: latestUserMessage.parts ?? [],
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

  const result = streamText({
    model: google("gemini-3-flash-preview"),
    messages: await convertToModelMessages((body.messages ?? []) as Parameters<typeof convertToModelMessages>[0]),
    tools: normalizedTools,
    system: `You are a UK data analyst. Answer with precision and cite the relevant data source/tool.
Use geography codes and UK postcodes carefully. Prefer tool calls when factual data is needed.`,
    onFinish: async (event) => {
      const persistPromise = (async () => {
        const assistantParts = buildAssistantPartsFromFinishEvent(event);
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
    },
  });

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

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: normalizedEmail,
  });
  if (linkError) {
    return json({ error: "Unable to sign in right now. Please try again." }, 500);
  }

  const actionLink = linkData?.properties?.action_link;
  if (!actionLink) return json({ error: "Unable to sign in right now. Please try again." }, 500);

  const redirectBase = getAuthRedirectBase(request);
  let finalLink = actionLink;
  const parsed = new URL(actionLink);
  parsed.searchParams.set("redirect_to", `${redirectBase.replace(/\/+$/, "")}/auth/callback`);
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
