import { Hono } from "hono";
import type { Env } from "../env.js";
import { getSupabaseAdmin, ensureAdmin, ensureAdminOrBootstrap, json } from "../_lib/server.js";
import { findUserIdByEmail, getProfileTokenMapByEmail } from "../_lib/internals.js";
import { onboardUser } from "../_lib/onboarding.js";
import { writeAdminAuditLog } from "../_lib/audit.js";
import { encryptMcpToken } from "../_lib/crypto.js";

export const adminRoutes = new Hono<{ Bindings: Env }>();

// GET /users + POST /users
adminRoutes.get("/users", async (c) => {
  const admin = await ensureAdmin(c.req.raw, c.env);
  if ("error" in admin) return admin.error;

  const supabase = getSupabaseAdmin(c.env);
  const { data, error } = await supabase
    .from("uk_chat_email_gate")
    .select("email,claimed_at,pending_mcp_token")
    .order("invited_at", { ascending: false });
  if (error) return json({ error: error.message }, 400);
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

  const { email } = (await c.req.json()) as { email?: string };
  if (!email) return json({ error: "Email is required" }, 400);
  try {
    const result = await onboardUser({ email, sendEmail: true }, c.env);
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

  const { email } = (await c.req.json()) as { email?: string };
  if (!email) return json({ error: "Email is required" }, 400);
  try {
    const result = await onboardUser({ email, rotateToken: true, sendEmail: false }, c.env);
    const supabase = getSupabaseAdmin(c.env);
    const targetUserId = await findUserIdByEmail(result.email, c.env);
    if (targetUserId && result.token) {
      const encrypted = await encryptMcpToken(result.token);
      await supabase
        .from("uk_chat_profiles")
        .upsert(encrypted ? { id: targetUserId, mcp_token: null, mcp_token_encrypted: encrypted } : { id: targetUserId, mcp_token: result.token }, { onConflict: "id" });
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
  const auth = await ensureAdminOrBootstrap(c.req.raw, c.env);
  if ("error" in auth) return auth.error;

  const body = (await c.req.json()) as {
    email?: string;
    sendEmail?: boolean;
    token?: string;
    rotateToken?: boolean;
    appUrl?: string;
  };
  if (!body.email) return json({ error: "Email is required" }, 400);

  try {
    const result = await onboardUser({
      email: body.email,
      sendEmail: body.sendEmail,
      token: body.token,
      rotateToken: body.rotateToken,
      appUrl: body.appUrl,
    }, c.env);
    await writeAdminAuditLog(c.env, {
      actorUserId: auth.user?.id ?? null,
      actorEmail: auth.user?.email ?? null,
      action: "admin.users.onboard",
      target: result.email,
      metadata: {
        tokenIssued: Boolean(result.tokenIssued),
        emailSent: Boolean(result.emailSent),
        viaBootstrapSecret: auth.user === null,
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
  if (error) return json({ error: error.message }, 400);

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
