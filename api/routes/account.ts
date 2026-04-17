import { Hono } from "hono";
import type { Env } from "../env.js";
import { getSupabaseAdmin, getUserFromRequest, json } from "../_lib/server.js";
import {
  ensureProfileExists,
  claimPendingMcpToken,
  readProfileMcpToken,
  PRIVACY_NOTICE_VERSION,
  CONVERSATION_SELECT_FIELDS,
} from "../_lib/internals.js";
import { writeAdminAuditLog } from "../_lib/audit.js";

export const accountRoutes = new Hono<{ Bindings: Env }>();

accountRoutes.get("/profile", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const supabase = getSupabaseAdmin(c.env);
  await ensureProfileExists(user, c.env);
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
});

accountRoutes.get("/export", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const supabase = getSupabaseAdmin(c.env);
  const [profileRow, emailGateRow, conversationsRow, usageRow, councilsRow, consentRow] = await Promise.all([
    supabase.from("uk_chat_profiles").select("id,email,display_name,theme_preference,created_at").eq("id", user.id).maybeSingle(),
    user.email
      ? supabase.from("uk_chat_email_gate").select("email,invited_at,claimed_at").eq("email", user.email.toLowerCase()).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("uk_chat_conversations")
      .select(CONVERSATION_SELECT_FIELDS)
      .eq("user_id", user.id)
      .is("deleted_at", null)
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
});

accountRoutes.delete("/", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const supabase = getSupabaseAdmin(c.env);
  await writeAdminAuditLog(c.env, {
    actorUserId: user.id,
    actorEmail: user.email ?? null,
    action: "account.delete.self",
    target: user.email ?? user.id,
  });
  const { error } = await supabase.auth.admin.deleteUser(user.id);
  if (error) return json({ error: "Failed to delete account." }, 500);
  return json({ success: true });
});
