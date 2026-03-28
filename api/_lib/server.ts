import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key);
}

export function getSupabaseAnon() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
  return createClient(url, key);
}

export async function getUserFromRequest(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.auth.getUser(token);
  return data.user ?? null;
}

export async function ensureAdmin(request: Request): Promise<{ user: User } | { error: Response }> {
  const user = await getUserFromRequest(request);
  if (!user) return { error: json({ error: "Unauthorized" }, 401) };
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || user.email?.toLowerCase() !== adminEmail.toLowerCase()) {
    return { error: json({ error: "Forbidden" }, 403) };
  }
  return { user };
}

export async function ensureAdminOrBootstrap(request: Request): Promise<{ user: User | null } | { error: Response }> {
  const bootstrapSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
  const providedSecret = request.headers.get("x-admin-bootstrap-secret");
  if (bootstrapSecret && providedSecret && providedSecret === bootstrapSecret) {
    return { user: null };
  }
  const admin = await ensureAdmin(request);
  if ("error" in admin) return admin;
  return { user: admin.user };
}
