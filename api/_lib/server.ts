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

// Memoize per-Request so middleware (rate limit) and route handlers don't
// each pay a Supabase auth round-trip for the same incoming request.
const userCache = new WeakMap<Request, Promise<User | null>>();

export async function getUserFromRequest(request: Request, env: Env) {
  const cached = userCache.get(request);
  if (cached) return cached;
  const promise = (async () => {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (!token) return null;
    const supabase = getSupabaseAdmin(env);
    const { data } = await supabase.auth.getUser(token);
    return data.user ?? null;
  })();
  userCache.set(request, promise);
  return promise;
}

export async function ensureAdmin(request: Request, env: Env): Promise<{ user: User; role: string } | { error: Response }> {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: json({ error: "Unauthorized" }, 401) };

  const supabase = getSupabaseAdmin(env);
  const { data: roleRow } = await supabase
    .from("uk_chat_admin_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleRow?.role) return { user, role: roleRow.role };

  // Bootstrap: if the roles table is empty and this user matches ADMIN_EMAIL,
  // grant them superadmin. After first bootstrap, ADMIN_EMAIL is effectively ignored.
  const adminEmail = env.ADMIN_EMAIL?.trim().toLowerCase();
  const userEmail = user.email?.toLowerCase();
  if (adminEmail && userEmail && userEmail === adminEmail) {
    const { count } = await supabase
      .from("uk_chat_admin_roles")
      .select("user_id", { count: "exact", head: true });
    if ((count ?? 0) === 0) {
      await supabase.from("uk_chat_admin_roles").upsert(
        { user_id: user.id, role: "superadmin", granted_by: user.id },
        { onConflict: "user_id" },
      );
      return { user, role: "superadmin" };
    }
  }

  return { error: json({ error: "Forbidden" }, 403) };
}
