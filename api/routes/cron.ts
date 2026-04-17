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

const SOFT_DELETE_BATCH_SIZE = 2000;
const AUDIT_BATCH_SIZE = 5000;
const DEFAULT_BUDGET_MS = 25_000;
const MAX_SWEEP_ITERATIONS = 50;

function clampDays(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function cutoffIso(days: number, now: number): string {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

export type RetentionConfig = {
  retentionDays: number;
  graceDays: number;
  auditDays: number;
};

export type RetentionResult = RetentionConfig & {
  inactiveCutoff: string;
  graceCutoff: string;
  auditCutoff: string;
  softDeleted: number;
  hardDeleted: number;
  auditPurged: number;
  iterations: { softDelete: number; hardDelete: number; audit: number };
  truncated: boolean;
  error?: string;
};

// Minimal shape of the Supabase surface this pipeline touches — lets tests supply a fake
// without pulling in @supabase/supabase-js types.
type SelectQuery = PromiseLike<{ data: Array<{ id: string }> | null; error: { message: string } | null }> & {
  is(column: string, value: null): SelectQuery;
  lt(column: string, value: string): SelectQuery;
  limit(n: number): SelectQuery;
};
type MutationQuery = PromiseLike<{ error: { message: string } | null }> & {
  in(column: string, values: string[]): MutationQuery;
  is(column: string, value: null): MutationQuery;
};
type RetentionTable = {
  select(columns: string): SelectQuery;
  update(values: Record<string, unknown>): MutationQuery;
  delete(): MutationQuery;
};
export type RetentionSupabase = { from(table: string): RetentionTable };

export function resolveRetentionConfig(env: Env): RetentionConfig {
  return {
    retentionDays: clampDays(env.DATA_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, 30, 3650),
    graceDays: clampDays(env.SOFT_DELETE_GRACE_DAYS, DEFAULT_SOFT_DELETE_GRACE_DAYS, 1, 365),
    auditDays: clampDays(env.AUDIT_LOG_RETENTION_DAYS, DEFAULT_AUDIT_LOG_RETENTION_DAYS, 30, 3650),
  };
}

export type PipelineOptions = {
  now?: number;
  budgetMs?: number;
  softDeleteBatchSize?: number;
  auditBatchSize?: number;
  maxIterations?: number;
};

export async function runRetentionPipeline(
  supabase: RetentionSupabase,
  config: RetentionConfig,
  options: PipelineOptions = {},
): Promise<RetentionResult> {
  const now = options.now ?? Date.now();
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const budgetStart = Date.now();
  const softBatch = options.softDeleteBatchSize ?? SOFT_DELETE_BATCH_SIZE;
  const auditBatch = options.auditBatchSize ?? AUDIT_BATCH_SIZE;
  const maxIter = options.maxIterations ?? MAX_SWEEP_ITERATIONS;

  const inactiveCutoff = cutoffIso(config.retentionDays, now);
  const graceCutoff = cutoffIso(config.graceDays, now);
  const auditCutoff = cutoffIso(config.auditDays, now);

  let softDeleted = 0;
  let hardDeleted = 0;
  let auditPurged = 0;
  const iterations = { softDelete: 0, hardDelete: 0, audit: 0 };
  let truncated = false;

  const overBudget = () => Date.now() - budgetStart >= budgetMs;
  const buildResult = (error?: string): RetentionResult => ({
    ...config,
    inactiveCutoff,
    graceCutoff,
    auditCutoff,
    softDeleted,
    hardDeleted,
    auditPurged,
    iterations,
    truncated,
    ...(error ? { error } : {}),
  });

  // 1. Soft-delete inactive conversations.
  for (let i = 0; i < maxIter; i += 1) {
    if (overBudget()) { truncated = true; break; }
    const { data, error } = await supabase
      .from("uk_chat_conversations")
      .select("id")
      .is("deleted_at", null)
      .lt("updated_at", inactiveCutoff)
      .limit(softBatch);
    if (error) return buildResult(error.message);
    const ids = (data ?? []).map((row) => row.id);
    if (ids.length === 0) break;
    const { error: updateError } = await supabase
      .from("uk_chat_conversations")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", ids)
      .is("deleted_at", null);
    if (updateError) return buildResult(updateError.message);
    softDeleted += ids.length;
    iterations.softDelete += 1;
    if (ids.length < softBatch) break;
    if (i === maxIter - 1) truncated = true;
  }

  // 2. Hard-delete conversations past the soft-delete grace window.
  // Messages FK has ON DELETE CASCADE (asserted in retention migration).
  for (let i = 0; i < maxIter; i += 1) {
    if (overBudget()) { truncated = true; break; }
    const { data, error } = await supabase
      .from("uk_chat_conversations")
      .select("id")
      .lt("deleted_at", graceCutoff)
      .limit(softBatch);
    if (error) return buildResult(error.message);
    const ids = (data ?? []).map((row) => row.id);
    if (ids.length === 0) break;
    const { error: deleteError } = await supabase.from("uk_chat_conversations").delete().in("id", ids);
    if (deleteError) return buildResult(deleteError.message);
    hardDeleted += ids.length;
    iterations.hardDelete += 1;
    if (ids.length < softBatch) break;
    if (i === maxIter - 1) truncated = true;
  }

  // 3. Purge old admin audit log rows.
  for (let i = 0; i < maxIter; i += 1) {
    if (overBudget()) { truncated = true; break; }
    const { data, error } = await supabase
      .from("uk_chat_admin_audit_log")
      .select("id")
      .lt("created_at", auditCutoff)
      .limit(auditBatch);
    if (error) return buildResult(error.message);
    const ids = (data ?? []).map((row) => row.id);
    if (ids.length === 0) break;
    const { error: deleteError } = await supabase.from("uk_chat_admin_audit_log").delete().in("id", ids);
    if (deleteError) return buildResult(deleteError.message);
    auditPurged += ids.length;
    iterations.audit += 1;
    if (ids.length < auditBatch) break;
    if (i === maxIter - 1) truncated = true;
  }

  return buildResult();
}

export async function runDataRetention(env: Env, options: PipelineOptions = {}): Promise<RetentionResult> {
  return runRetentionPipeline(getSupabaseAdmin(env) as unknown as RetentionSupabase, resolveRetentionConfig(env), options);
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
