import { Hono } from "hono";
import type { Env } from "../env.js";
import { getSupabaseAdmin, getUserFromRequest, json } from "../_lib/server.js";
import { extractArtifactsFromMessages } from "../_lib/internals.js";

export const artifactRoutes = new Hono<{ Bindings: Env }>();

artifactRoutes.get("/", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const currentConversationId = c.req.query("currentConversationId")?.trim() || null;
  const supabase = getSupabaseAdmin(c.env);
  const { data: conversations, error: conversationsError } = await supabase
    .from("uk_chat_conversations")
    .select("id,title,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(16);
  if (conversationsError) return json({ error: conversationsError.message }, 500);
  if (!conversations || conversations.length === 0) return json({ conversations: [] });

  const conversationIds = conversations.map((conversation) => conversation.id);
  const { data: messages, error: messagesError } = await supabase
    .from("uk_chat_messages")
    .select("id,conversation_id,parts,created_at")
    .in("conversation_id", conversationIds)
    .eq("role", "assistant")
    .order("created_at", { ascending: false });
  if (messagesError) return json({ error: messagesError.message }, 500);

  const messageByConversation = new Map<string, Array<{ id: string; conversation_id: string; parts: unknown[]; created_at: string }>>();
  for (const message of messages ?? []) {
    const normalized = {
      id: message.id,
      conversation_id: message.conversation_id,
      parts: Array.isArray(message.parts) ? message.parts : [],
      created_at: message.created_at,
    };
    const existing = messageByConversation.get(message.conversation_id) ?? [];
    existing.push(normalized);
    messageByConversation.set(message.conversation_id, existing);
  }

  const anchorUpdatedAt =
    currentConversationId && conversations.some((conversation) => conversation.id === currentConversationId)
      ? new Date(conversations.find((conversation) => conversation.id === currentConversationId)!.updated_at).getTime()
      : null;

  const withArtifacts = conversations
    .map((conversation) => {
      const conversationMessages = messageByConversation.get(conversation.id) ?? [];
      const artifacts = extractArtifactsFromMessages(conversationMessages, conversation.id).slice(0, 24);
      return {
        id: conversation.id,
        title: conversation.title,
        updated_at: conversation.updated_at,
        artifacts,
      };
    })
    .filter((conversation) => conversation.artifacts.length > 0);

  withArtifacts.sort((a, b) => {
    if (currentConversationId) {
      if (a.id === currentConversationId && b.id !== currentConversationId) return -1;
      if (b.id === currentConversationId && a.id !== currentConversationId) return 1;
    }
    if (anchorUpdatedAt != null) {
      const deltaA = Math.abs(new Date(a.updated_at).getTime() - anchorUpdatedAt);
      const deltaB = Math.abs(new Date(b.updated_at).getTime() - anchorUpdatedAt);
      if (deltaA !== deltaB) return deltaA - deltaB;
    }
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  return json({ conversations: withArtifacts.slice(0, 10) });
});
