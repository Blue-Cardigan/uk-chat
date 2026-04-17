import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import { getSupabaseAdmin, ensureAdmin, json } from "../_lib/server.js";
import { findUserIdByEmail, getProfileTokenMapByEmail } from "../_lib/internals.js";
import { onboardUser } from "../_lib/onboarding.js";
import { writeAdminAuditLog } from "../_lib/audit.js";
import { encryptMcpToken } from "../_lib/crypto.js";
import { parseJson, emailSchema, dbError } from "../_lib/validation.js";

export const adminRoutes = new Hono<{ Bindings: Env }>();

const emailBodySchema = z.object({ email: emailSchema });
const onboardBodySchema = z.object({
  email: emailSchema,
  sendEmail: z.boolean().optional(),
  token: z.string().min(8).max(512).optional(),
  rotateToken: z.boolean().optional(),
  appUrl: z.string().url().optional(),
});

// GET /users + POST /users
adminRoutes.get("/users", async (c) => {
  const admin = await ensureAdmin(c.req.raw, c.env);
  if ("error" in admin) return admin.error;

  const supabase = getSupabaseAdmin(c.env);
  const { data, error } = await supabase
    .from("uk_chat_email_gate")
    .select("email,claimed_at,pending_mcp_token")
    .order("invited_at", { ascending: false });
  if (error) return dbError(error, { context: "api/admin/users", publicMessage: "Failed to load users", status: 400 });
  const emails = (data ?? []).map((row) => row.email);
  const profileTokenMap = await getProfileTokenMapByEmail(emails, c.env);
  await writeAdminAuditLog(c.env, {
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
});

adminRoutes.post("/users", async (c) => {
  const admin = await ensureAdmin(c.req.raw, c.env);
  if ("error" in admin) return admin.error;

  const parsed = await parseJson(c, emailBodySchema);
  if ("response" in parsed) return parsed.response;
  try {
    const result = await onboardUser({ email: parsed.data.email, sendEmail: true }, c.env);
    await writeAdminAuditLog(c.env, {
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
});

// POST /tokens
adminRoutes.post("/tokens", async (c) => {
  const admin = await ensureAdmin(c.req.raw, c.env);
  if ("error" in admin) return admin.error;

  const parsed = await parseJson(c, emailBodySchema);
  if ("response" in parsed) return parsed.response;
  try {
    const result = await onboardUser({ email: parsed.data.email, rotateToken: true, sendEmail: false }, c.env);
    const supabase = getSupabaseAdmin(c.env);
    const targetUserId = await findUserIdByEmail(result.email, c.env);
    if (targetUserId && result.token) {
      const encrypted = await encryptMcpToken(result.token);
      await supabase
        .from("uk_chat_profiles")
        .upsert({ id: targetUserId, mcp_token: null, mcp_token_encrypted: encrypted }, { onConflict: "id" });
    }
    await writeAdminAuditLog(c.env, {
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
});

// POST /onboard-user
adminRoutes.post("/onboard-user", async (c) => {
  const admin = await ensureAdmin(c.req.raw, c.env);
  if ("error" in admin) return admin.error;

  const parsed = await parseJson(c, onboardBodySchema);
  if ("response" in parsed) return parsed.response;
  const body = parsed.data;

  try {
    const result = await onboardUser({
      email: body.email,
      sendEmail: body.sendEmail,
      token: body.token,
      rotateToken: body.rotateToken,
      appUrl: body.appUrl,
    }, c.env);
    await writeAdminAuditLog(c.env, {
      actorUserId: admin.user.id,
      actorEmail: admin.user.email ?? null,
      action: "admin.users.onboard",
      target: result.email,
      metadata: {
        tokenIssued: Boolean(result.tokenIssued),
        emailSent: Boolean(result.emailSent),
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
});

// GET /admins — list admin role grants
adminRoutes.get("/admins", async (c) => {
  const admin = await ensureAdmin(c.req.raw, c.env);
  if ("error" in admin) return admin.error;

  const supabase = getSupabaseAdmin(c.env);
  const { data, error } = await supabase
    .from("uk_chat_admin_roles")
    .select("user_id,role,granted_by,granted_at")
    .order("granted_at", { ascending: false });
  if (error) return dbError(error, { context: "api/admin/admins GET", publicMessage: "Failed to load admins", status: 400 });

  const userIdSet = new Set<string>();
  for (const row of data ?? []) {
    userIdSet.add(row.user_id);
    if (row.granted_by) userIdSet.add(row.granted_by);
  }
  const userIds = Array.from(userIdSet);
  const emailByUserId = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase.from("uk_chat_profiles").select("id,email").in("id", userIds);
    for (const row of profiles ?? []) if (row.email) emailByUserId.set(row.id, row.email);
  }

  return json(
    (data ?? []).map((row) => ({
      userId: row.user_id,
      email: emailByUserId.get(row.user_id) ?? null,
      role: row.role,
      grantedByEmail: row.granted_by ? emailByUserId.get(row.granted_by) ?? null : null,
      grantedAt: row.granted_at,
    })),
  );
});

const grantAdminSchema = z.object({ email: emailSchema, role: z.enum(["admin", "superadmin"]).optional() });

adminRoutes.post("/admins", async (c) => {
  const admin = await ensureAdmin(c.req.raw, c.env);
  if ("error" in admin) return admin.error;

  const parsed = await parseJson(c, grantAdminSchema);
  if ("response" in parsed) return parsed.response;
  const { email, role = "admin" } = parsed.data;

  const supabase = getSupabaseAdmin(c.env);
  const targetUserId = await findUserIdByEmail(email, c.env);
  if (!targetUserId) return json({ error: "User not found" }, 404);

  const { error } = await supabase
    .from("uk_chat_admin_roles")
    .upsert({ user_id: targetUserId, role, granted_by: admin.user.id }, { onConflict: "user_id" });
  if (error) return dbError(error, { context: "api/admin/admins POST", publicMessage: "Failed to grant admin", status: 400 });

  await writeAdminAuditLog(c.env, {
    actorUserId: admin.user.id,
    actorEmail: admin.user.email ?? null,
    action: "admin.roles.grant",
    target: email,
    metadata: { role },
  });
  return json({ ok: true });
});

adminRoutes.delete("/admins/:userId", async (c) => {
  const admin = await ensureAdmin(c.req.raw, c.env);
  if ("error" in admin) return admin.error;

  const targetUserId = c.req.param("userId");
  if (targetUserId === admin.user.id) return json({ error: "Cannot revoke your own admin role" }, 400);

  const supabase = getSupabaseAdmin(c.env);
  const { error } = await supabase.from("uk_chat_admin_roles").delete().eq("user_id", targetUserId);
  if (error) return dbError(error, { context: "api/admin/admins DELETE", publicMessage: "Failed to revoke admin", status: 400 });

  await writeAdminAuditLog(c.env, {
    actorUserId: admin.user.id,
    actorEmail: admin.user.email ?? null,
    action: "admin.roles.revoke",
    target: targetUserId,
    metadata: {},
  });
  return json({ ok: true });
});

// GET /system-settings/council-source
adminRoutes.get("/system-settings/council-source", async (c) => {
  const admin = await ensureAdmin(c.req.raw, c.env);
  if ("error" in admin) return admin.error;

  const supabase = getSupabaseAdmin(c.env);
  const settingKeys = [
    "council_national_source_preference",
    "council_national_whatgov_mps_table",
    "council_national_whatgov_debates_table",
  ];
  const { data, error } = await supabase.from("system_settings").select("key,value").in("key", settingKeys);
  if (error) return dbError(error, { context: "api/admin/system-settings", publicMessage: "Failed to load system settings", status: 400 });

  const values = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ key?: string | null; value?: string | null }>) {
    if (!row.key) continue;
    values.set(row.key, row.value ?? "");
  }

  const envPreference = c.env.COUNCIL_NATIONAL_SOURCE_PREFERENCE?.trim() || null;
  const envMpsTable = c.env.COUNCIL_NATIONAL_WHATGOV_MPS_TABLE?.trim() || null;
  const envDebatesTable = c.env.COUNCIL_NATIONAL_WHATGOV_DEBATES_TABLE?.trim() || null;

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
});
