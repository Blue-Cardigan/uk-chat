import { Hono } from "hono";
import type { Env } from "../env.js";
import { getSupabaseAdmin, json } from "../_lib/server.js";
import { DEFAULT_RETENTION_DAYS } from "../_lib/internals.js";

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

function authenticateCron(c: { env: Env; req: { raw: Request } }): Response | null {
  const cronSecret = c.env.CRON_SECRET;
  if (!cronSecret) return json({ error: "CRON_SECRET is required" }, 500);
  const authHeader = c.req.raw.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== cronSecret) return json({ error: "Unauthorized" }, 401);
  return null;
}

cronRoutes.get("/data-retention", async (c) => {
  const authError = authenticateCron(c);
  if (authError) return authError;

  const result = await runDataRetention(c.env);
  if (result.error) return json({ error: result.error }, 500);
  return json(result);
});

cronRoutes.post("/data-retention", async (c) => {
  const authError = authenticateCron(c);
  if (authError) return authError;

  const result = await runDataRetention(c.env);
  if (result.error) return json({ error: result.error }, 500);
  return json(result);
});
