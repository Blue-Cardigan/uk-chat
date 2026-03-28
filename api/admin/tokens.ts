import { ensureAdmin, getSupabaseAdmin, json } from "../_lib/server";
import { onboardUser } from "../_lib/onboarding";

async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  let page = 1;
  const perPage = 200;
  while (page < 50) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) break;
    const users = data.users ?? [];
    if (users.length === 0) break;
    const match = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (users.length < perPage) break;
    page += 1;
  }
  return null;
}

export async function POST(request: Request) {
  const admin = await ensureAdmin(request);
  if ("error" in admin) return admin.error;
  const { email } = (await request.json()) as { email?: string };
  if (!email) return json({ error: "Email is required" }, 400);
  try {
    const result = await onboardUser({ email, rotateToken: true, sendEmail: false });
    const supabase = getSupabaseAdmin();
    const targetUserId = await findUserIdByEmail(result.email);
    if (targetUserId && result.token) {
      await supabase.from("uk_chat_profiles").upsert({ id: targetUserId, mcp_token: result.token }, { onConflict: "id" });
    }
    return json({ token: result.token });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token issuing failed";
    return json({ error: message }, 400);
  }
}
