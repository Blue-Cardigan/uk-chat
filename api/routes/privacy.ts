import { Hono } from "hono";
import type { Env } from "../env.js";
import { getSupabaseAdmin, getUserFromRequest, json } from "../_lib/server.js";
import { ensureProfileExists, PRIVACY_NOTICE_VERSION } from "../_lib/internals.js";

export const privacyRoutes = new Hono<{ Bindings: Env }>();

privacyRoutes.get("/consent", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const supabase = getSupabaseAdmin(c.env);
  await ensureProfileExists(user, c.env);

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
});

privacyRoutes.put("/consent", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const supabase = getSupabaseAdmin(c.env);
  await ensureProfileExists(user, c.env);

  const body = (await c.req.json().catch(() => ({}))) as {
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
});
