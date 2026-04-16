import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { Env } from "../env.js";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function getSupabaseAdmin(env: Env) {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key);
}

export async function getUserFromRequest(request: Request, env: Env) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase.auth.getUser(token);
  return data.user ?? null;
}

export async function ensureAdmin(request: Request, env: Env): Promise<{ user: User } | { error: Response }> {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: json({ error: "Unauthorized" }, 401) };
  const adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail || user.email?.toLowerCase() !== adminEmail.toLowerCase()) {
    return { error: json({ error: "Forbidden" }, 403) };
  }
  return { user };
}
