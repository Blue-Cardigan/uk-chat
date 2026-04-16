import { Hono } from "hono";
import type { Env } from "../env.js";
import { getSupabaseAdmin, json } from "../_lib/server.js";
import { extractArtifactsFromMessages, SHARED_CONVERSATION_SELECT_FIELDS } from "../_lib/internals.js";
import { parseParam, shareTokenSchema, dbError } from "../_lib/validation.js";
import { ipRateLimit } from "../_lib/rate-limit.js";

export const sharedRoutes = new Hono<{ Bindings: Env }>();

sharedRoutes.use("*", ipRateLimit("SHARE_LIMITER"));

sharedRoutes.get("/:token", async (c) => {
  const tokenResult = parseParam(c, "token", shareTokenSchema);
  if (!tokenResult.ok) return json({ error: "Not found" }, 404);
  const token = tokenResult.data;
  const supabase = getSupabaseAdmin(c.env);

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
  if (messageError) return dbError(messageError, { context: "api/shared/:token", publicMessage: "Failed to load messages", status: 400 });

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
    artifacts: extractArtifactsFromMessages(normalizedMessages, conversation.id),
  });
});
