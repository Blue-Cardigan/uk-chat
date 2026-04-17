import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import { getSupabaseAdmin, getUserFromRequest, json } from "../_lib/server.js";
import {
  ensureProfileExists,
  getAuthRedirectBase,
  createShareToken,
  buildShareExpiryIso,
  CONVERSATION_SELECT_FIELDS,
  DEFAULT_SHARE_EXPIRY_DAYS,
} from "../_lib/internals.js";
import { logWarn } from "../_lib/logger.js";
import { parseJson, parseParam, uuidSchema, dbError } from "../_lib/validation.js";

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const conversationRoutes = new Hono<{ Bindings: Env }>();

const createBodySchema = z.object({ title: z.string().max(500).optional() });
const patchBodySchema = z.object({
  title: z.string().max(500).optional(),
  starred: z.boolean().optional(),
});
const shareUpdateBodySchema = z.object({
  enabled: z.boolean(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

// GET / — list conversations
conversationRoutes.get("/", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  try {
    await ensureProfileExists(user, c.env);
  } catch (error) {
    return dbError(error as { message?: string }, { context: "api/conversations", publicMessage: "Failed to prepare user profile" });
  }
  const supabase = getSupabaseAdmin(c.env);

  const { data, error } = await supabase
    .from("uk_chat_conversations")
    .select(CONVERSATION_SELECT_FIELDS)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("starred", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) return dbError(error, { context: "api/conversations", publicMessage: "Failed to load conversations" });
  return json(data ?? []);
});

// POST / — create conversation
conversationRoutes.post("/", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  try {
    await ensureProfileExists(user, c.env);
  } catch (error) {
    return dbError(error as { message?: string }, { context: "api/conversations", publicMessage: "Failed to prepare user profile" });
  }
  const supabase = getSupabaseAdmin(c.env);

  const parsed = await parseJson(c, createBodySchema);
  if (!parsed.ok) return parsed.response;
  const payload = { user_id: user.id, title: parsed.data.title?.trim() || "New chat" };
  const createConversation = () =>
    supabase.from("uk_chat_conversations").insert(payload).select(CONVERSATION_SELECT_FIELDS).single();

  let { data, error } = await createConversation();

  // If profile creation and first conversation insert race, recover once.
  if (error && error.code === "23503") {
    try {
      await ensureProfileExists(user, c.env);
    } catch (ensureError) {
      return dbError(ensureError as { message?: string }, { context: "api/conversations", publicMessage: "Failed to prepare user profile" });
    }
    const retry = await createConversation();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    const status = error.code?.startsWith("22") ? 400 : 500;
    return dbError(error, { context: "api/conversations", publicMessage: "Failed to create conversation", status });
  }

  return json(data, 201);
});

// GET /:id — get conversation with messages
conversationRoutes.get("/:id", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const idResult = parseParam(c, "id", uuidSchema);
  if (!idResult.ok) return idResult.response;
  const id = idResult.data;
  const supabase = getSupabaseAdmin(c.env);

  const { data: conversation, error: conversationError } = await supabase
    .from("uk_chat_conversations")
    .select(CONVERSATION_SELECT_FIELDS)
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .single();
  if (conversationError) {
    logWarn("[api/conversations/:id] lookup failed", {
      conversationId: id,
      userId: user.id,
      userEmail: user.email ?? null,
      error: conversationError.message,
      code: conversationError.code ?? null,
    });
    return json({ error: "Conversation not found" }, 404);
  }

  const { data: messages, error: messageError } = await supabase
    .from("uk_chat_messages")
    .select("id,conversation_id,role,parts,created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });
  if (messageError) return dbError(messageError, { context: "api/conversations/:id", publicMessage: "Failed to load messages" });

  return json({ conversation, messages: messages ?? [] });
});

// PATCH /:id — update conversation
conversationRoutes.patch("/:id", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const idResult = parseParam(c, "id", uuidSchema);
  if (!idResult.ok) return idResult.response;
  const id = idResult.data;
  const supabase = getSupabaseAdmin(c.env);

  const parsed = await parseJson(c, patchBodySchema);
  if (!parsed.ok) return parsed.response;
  const { title, starred } = parsed.data;
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
    .is("deleted_at", null)
    .select(CONVERSATION_SELECT_FIELDS)
    .single();
  if (error) return dbError(error, { context: "api/conversations/:id PATCH", publicMessage: "Failed to update conversation", status: 400 });
  return json(data);
});

// DELETE /:id — delete conversation
conversationRoutes.delete("/:id", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const idResult = parseParam(c, "id", uuidSchema);
  if (!idResult.ok) return idResult.response;
  const id = idResult.data;
  const supabase = getSupabaseAdmin(c.env);

  const { error } = await supabase
    .from("uk_chat_conversations")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null);
  if (error) return dbError(error, { context: "api/conversations/:id DELETE", publicMessage: "Failed to delete conversation", status: 400 });
  return json({ success: true });
});

// POST /:id/share — create share link
conversationRoutes.post("/:id/share", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const idResult = parseParam(c, "id", uuidSchema);
  if (!idResult.ok) return idResult.response;
  const id = idResult.data;
  const supabase = getSupabaseAdmin(c.env);

  const { data: conversation, error: conversationError } = await supabase
    .from("uk_chat_conversations")
    .select("id,title,is_public,share_token")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
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
      share_expires_at: buildShareExpiryIso(DEFAULT_SHARE_EXPIRY_DAYS),
      updated_at: now,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .select(CONVERSATION_SELECT_FIELDS)
    .single();
  if (error || !data) return dbError(error, { context: "api/conversations/:id/share", publicMessage: "Failed to share conversation", status: 400 });

  const shareUrl = `${getAuthRedirectBase(c.req.raw, c.env).replace(/\/+$/, "")}/shared/${shareToken}`;
  return json({ conversation: data, shareUrl });
});

// PATCH /:id/share — update share settings
conversationRoutes.patch("/:id/share", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const idResult = parseParam(c, "id", uuidSchema);
  if (!idResult.ok) return idResult.response;
  const id = idResult.data;
  const supabase = getSupabaseAdmin(c.env);

  const { data: conversation, error: conversationError } = await supabase
    .from("uk_chat_conversations")
    .select("id,title,is_public,share_token")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .single();
  if (conversationError || !conversation) {
    return json({ error: "Conversation not found" }, 404);
  }

  const parsed = await parseJson(c, shareUpdateBodySchema);
  if (!parsed.ok) return parsed.response;
  const now = new Date().toISOString();
  const enabled = parsed.data.enabled;
  const expiresInDays = parsed.data.expiresInDays ?? DEFAULT_SHARE_EXPIRY_DAYS;
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
    .is("deleted_at", null)
    .select(CONVERSATION_SELECT_FIELDS)
    .single();
  if (error || !data) return dbError(error, { context: "api/conversations/:id/share PATCH", publicMessage: "Failed to update share settings", status: 400 });
  if (enabled && nextShareToken) {
    const shareUrl = `${getAuthRedirectBase(c.req.raw, c.env).replace(/\/+$/, "")}/shared/${nextShareToken}`;
    return json({ conversation: data, shareUrl });
  }
  return json({ conversation: data, shareUrl: null });
});
