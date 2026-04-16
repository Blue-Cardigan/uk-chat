import { Hono } from "hono";
import type { Env } from "../env.js";
import { getSupabaseAdmin, json } from "../_lib/server.js";
import { DEFAULT_RETENTION_DAYS } from "../_lib/internals.js";
import { dbError } from "../_lib/validation.js";

export const cronRoutes = new Hono<{ Bindings: Env }>();

function computeRetention(env: Env) {
  const retentionDaysRaw = Number(env.DATA_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
  const retentionDays = Number.isFinite(retentionDaysRaw) ? Math.max(30, Math.min(3650, Math.round(retentionDaysRaw))) : DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  return { retentionDays, cutoff };
}

export async function runDataRetention(env: Env) {
  const { retentionDays, cutoff } = computeRetention(env);
  const supabase = getSupabaseAdmin(env);
  const { data: staleRows, error: staleError } = await supabase
    .from("uk_chat_conversations")
    .select("id")
    .lt("updated_at", cutoff)
    .limit(2000);
  if (staleError) return { error: staleError.message, deletedCount: 0, retentionDays, cutoff };
  const staleIds = (staleRows ?? []).map((row) => row.id);
  if (staleIds.length === 0) return { deletedCount: 0, retentionDays, cutoff };

  const { error: deleteError } = await supabase.from("uk_chat_conversations").delete().in("id", staleIds);
  if (deleteError) return { error: deleteError.message, deletedCount: 0, retentionDays, cutoff };
  return { deletedCount: staleIds.length, retentionDays, cutoff };
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

async function authenticateCron(c: { env: Env; req: { raw: Request } }): Promise<Response | null> {
  const cronSecret = c.env.CRON_SECRET;
  if (!cronSecret) return json({ error: "CRON_SECRET is required" }, 500);

  const authHeader = c.req.raw.headers.get("authorization") ?? "";
  const provided = authHeader.replace(/^Bearer\s+/i, "").trim();
  const timestampHeader = c.req.raw.headers.get("x-signature-timestamp");
  if (!provided || !timestampHeader) return json({ error: "Unauthorized" }, 401);

  const timestamp = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(timestamp)) return json({ error: "Unauthorized" }, 401);
  const timestampMs = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  if (Math.abs(Date.now() - timestampMs) > MAX_TIMESTAMP_SKEW_MS) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(c.req.raw.url);
  const message = `${c.req.raw.method.toUpperCase()}\n${url.pathname}\n${timestampHeader}`;
  const expected = await computeSignature(cronSecret, message);
  const providedBytes = hexToBytes(provided.toLowerCase());
  if (!providedBytes || !constantTimeEqual(expected, providedBytes)) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
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
