import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import { getSupabaseAdmin, getUserFromRequest, json } from "../_lib/server.js";
import { ensureProfileExists, PRIVACY_NOTICE_VERSION } from "../_lib/internals.js";
import { parseJson, dbError } from "../_lib/validation.js";

const consentBodySchema = z.object({
  acknowledgeAiProcessing: z.boolean().optional(),
  acknowledgeSharingWarning: z.boolean().optional(),
});

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
  if (error) return dbError(error, { context: "api/privacy/consent GET", publicMessage: "Failed to load consent" });
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

  const parsed = await parseJson(c, consentBodySchema);
  if (!parsed.ok) return parsed.response;
  const now = new Date().toISOString();
  const patch = {
    user_id: user.id,
    privacy_notice_version: PRIVACY_NOTICE_VERSION,
    ai_processing_acknowledged_at: parsed.data.acknowledgeAiProcessing ? now : null,
    sharing_warning_acknowledged_at: parsed.data.acknowledgeSharingWarning ? now : null,
    updated_at: now,
  };
  const { data, error } = await supabase
    .from("uk_chat_user_consents")
    .upsert(patch, { onConflict: "user_id" })
    .select("privacy_notice_version,ai_processing_acknowledged_at,sharing_warning_acknowledged_at,updated_at")
    .single();
  if (error) return dbError(error, { context: "api/privacy/consent PUT", publicMessage: "Failed to update consent" });
  return json({
    privacyNoticeVersion: data.privacy_notice_version,
    aiProcessingAcknowledgedAt: data.ai_processing_acknowledged_at,
    sharingWarningAcknowledgedAt: data.sharing_warning_acknowledged_at,
    updatedAt: data.updated_at,
    currentVersion: PRIVACY_NOTICE_VERSION,
  });
});
