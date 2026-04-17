import { Hono } from "hono";
import type { Env } from "../env.js";
import { getSupabaseAdmin, json } from "../_lib/server.js";
import {
  DEFAULT_RETENTION_DAYS,
  DEFAULT_SOFT_DELETE_GRACE_DAYS,
  DEFAULT_AUDIT_LOG_RETENTION_DAYS,
} from "../_lib/internals.js";
import { dbError } from "../_lib/validation.js";

export const cronRoutes = new Hono<{ Bindings: Env }>();

const SOFT_DELETE_SWEEP_LIMIT = 2000;
const AUDIT_SWEEP_LIMIT = 5000;

function clampDays(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function runDataRetention(env: Env) {
  const retentionDays = clampDays(env.DATA_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, 30, 3650);
  const graceDays = clampDays(env.SOFT_DELETE_GRACE_DAYS, DEFAULT_SOFT_DELETE_GRACE_DAYS, 1, 365);
  const auditDays = clampDays(env.AUDIT_LOG_RETENTION_DAYS, DEFAULT_AUDIT_LOG_RETENTION_DAYS, 30, 3650);

  const inactiveCutoff = cutoffIso(retentionDays);
  const graceCutoff = cutoffIso(graceDays);
  const auditCutoff = cutoffIso(auditDays);

  const supabase = getSupabaseAdmin(env);
  const baseResult: {
    retentionDays: number;
    graceDays: number;
    auditDays: number;
    inactiveCutoff: string;
    graceCutoff: string;
    auditCutoff: string;
    softDeleted: number;
    hardDeleted: number;
    auditPurged: number;
    error?: string;
  } = {
    retentionDays,
    graceDays,
    auditDays,
    inactiveCutoff,
    graceCutoff,
    auditCutoff,
    softDeleted: 0,
    hardDeleted: 0,
    auditPurged: 0,
  };

  // 1. Soft-delete inactive conversations.
  const { data: staleRows, error: staleError } = await supabase
    .from("uk_chat_conversations")
    .select("id")
    .is("deleted_at", null)
    .lt("updated_at", inactiveCutoff)
    .limit(SOFT_DELETE_SWEEP_LIMIT);
  if (staleError) return { ...baseResult, error: staleError.message };
  const staleIds = (staleRows ?? []).map((row) => row.id);
  if (staleIds.length > 0) {
    const { error: softErr } = await supabase
      .from("uk_chat_conversations")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", staleIds)
      .is("deleted_at", null);
    if (softErr) return { ...baseResult, error: softErr.message };
    baseResult.softDeleted = staleIds.length;
  }

  // 2. Hard-delete conversations past the soft-delete grace window (cascade handles children).
  const { data: expiredRows, error: expiredError } = await supabase
    .from("uk_chat_conversations")
    .select("id")
    .lt("deleted_at", graceCutoff)
    .limit(SOFT_DELETE_SWEEP_LIMIT);
  if (expiredError) return { ...baseResult, error: expiredError.message };
  const expiredIds = (expiredRows ?? []).map((row) => row.id);
  if (expiredIds.length > 0) {
    const { error: hardErr } = await supabase.from("uk_chat_conversations").delete().in("id", expiredIds);
    if (hardErr) return { ...baseResult, error: hardErr.message };
    baseResult.hardDeleted = expiredIds.length;
  }

  // 3. Purge old admin audit log rows.
  const { data: oldAudit, error: auditSelectError } = await supabase
    .from("uk_chat_admin_audit_log")
    .select("id")
    .lt("created_at", auditCutoff)
    .limit(AUDIT_SWEEP_LIMIT);
  if (auditSelectError) return { ...baseResult, error: auditSelectError.message };
  const auditIds = (oldAudit ?? []).map((row) => row.id);
  if (auditIds.length > 0) {
    const { error: auditDeleteError } = await supabase.from("uk_chat_admin_audit_log").delete().in("id", auditIds);
    if (auditDeleteError) return { ...baseResult, error: auditDeleteError.message };
    baseResult.auditPurged = auditIds.length;
  }

  return baseResult;
}

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byte)) return null;
    out[i] = byte;
  }
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function computeSignature(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

export type CronAuthResult = "ok" | "unauthorized" | "misconfigured";

export async function verifyCronAuth(input: {
  secret: string | undefined;
  method: string;
  path: string;
  authorizationHeader: string | null;
  timestampHeader: string | null;
  now?: number;
}): Promise<CronAuthResult> {
  if (!input.secret) return "misconfigured";

  const provided = (input.authorizationHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  const timestampHeader = input.timestampHeader;
  if (!provided || !timestampHeader) return "unauthorized";

  const timestamp = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(timestamp)) return "unauthorized";
  // Accept either Unix seconds (10 digits) or milliseconds (13 digits) — disambiguated by magnitude.
  const timestampMs = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  const now = input.now ?? Date.now();
  if (Math.abs(now - timestampMs) > MAX_TIMESTAMP_SKEW_MS) return "unauthorized";

  const message = `${input.method.toUpperCase()}\n${input.path}\n${timestampHeader}`;
  const expected = await computeSignature(input.secret, message);
  const providedBytes = hexToBytes(provided.toLowerCase());
  if (!providedBytes || !constantTimeEqual(expected, providedBytes)) return "unauthorized";
  return "ok";
}

async function authenticateCron(c: { env: Env; req: { raw: Request } }): Promise<Response | null> {
  const url = new URL(c.req.raw.url);
  const result = await verifyCronAuth({
    secret: c.env.CRON_SECRET,
    method: c.req.raw.method,
    path: url.pathname,
    authorizationHeader: c.req.raw.headers.get("authorization"),
    timestampHeader: c.req.raw.headers.get("x-signature-timestamp"),
  });
  if (result === "ok") return null;
  if (result === "misconfigured") return json({ error: "CRON_SECRET is required" }, 500);
  return json({ error: "Unauthorized" }, 401);
}

cronRoutes.get("/data-retention", async (c) => {
  const authError = await authenticateCron(c);
  if (authError) return authError;

  const result = await runDataRetention(c.env);
  if (result.error) {
    return dbError({ message: result.error }, { context: "api/cron/data-retention GET", publicMessage: "Retention job failed" });
  }
  return json(result);
});

cronRoutes.post("/data-retention", async (c) => {
  const authError = await authenticateCron(c);
  if (authError) return authError;

  const result = await runDataRetention(c.env);
  if (result.error) {
    return dbError({ message: result.error }, { context: "api/cron/data-retention POST", publicMessage: "Retention job failed" });
  }
  return json(result);
});
