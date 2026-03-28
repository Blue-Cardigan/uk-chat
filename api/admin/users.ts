import { ensureAdmin, getSupabaseAdmin, json } from "../_lib/server";
import { onboardUser } from "../_lib/onboarding";

async function getProfileTokenMapByEmail(emails: string[]) {
  const supabase = getSupabaseAdmin();
  let page = 1;
  const perPage = 200;
  const out = new Map<string, string | null>();
  const emailSet = new Set(emails.map((email) => email.toLowerCase()));
  while (page < 50 && emailSet.size > 0) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) break;
    const users = data.users ?? [];
    if (users.length === 0) break;
    const matchingIds: string[] = [];
    const idToEmail = new Map<string, string>();
    for (const user of users) {
      const email = user.email?.toLowerCase();
      if (!email || !emailSet.has(email)) continue;
      matchingIds.push(user.id);
      idToEmail.set(user.id, email);
    }
    if (matchingIds.length > 0) {
      const { data: profiles } = await supabase.from("uk_chat_profiles").select("id,mcp_token").in("id", matchingIds);
      for (const profile of profiles ?? []) {
        const email = idToEmail.get(profile.id);
        if (!email) continue;
        out.set(email, profile.mcp_token);
        emailSet.delete(email);
      }
    }
    if (users.length < perPage) break;
    page += 1;
  }
  return out;
}

export async function GET(request: Request) {
  const admin = await ensureAdmin(request);
  if ("error" in admin) return admin.error;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("uk_chat_email_gate")
    .select("email,claimed_at,pending_mcp_token")
    .order("invited_at", { ascending: false });
  if (error) return json({ error: error.message }, 400);
  const emails = (data ?? []).map((row) => row.email);
  const profileTokenMap = await getProfileTokenMapByEmail(emails);
  return json(
    (data ?? []).map((row) => ({
      email: row.email,
      status: row.claimed_at ? "claimed" : "invited",
      hasToken: Boolean(row.pending_mcp_token) || Boolean(profileTokenMap.get(row.email.toLowerCase())),
    })),
  );
}

export async function POST(request: Request) {
  const admin = await ensureAdmin(request);
  if ("error" in admin) return admin.error;
  const { email } = (await request.json()) as { email?: string };
  if (!email) return json({ error: "Email is required" }, 400);
  try {
    const result = await onboardUser({ email, sendEmail: true });
    return json({
      message: "User invited, token issued, and magic link email sent",
      user: { email: result.email, status: "invited", hasToken: Boolean(result.token) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Onboarding failed";
    return json({ error: message }, 400);
  }
}
