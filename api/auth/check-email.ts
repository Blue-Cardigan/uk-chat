import { getSupabaseAdmin, json } from "../_lib/server";

export async function POST(request: Request) {
  const { email } = (await request.json()) as { email?: string };
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return json({ error: "Email is required" }, 400);
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("uk_chat_email_gate")
    .select("email")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (error) {
    return json({ error: "Unable to verify email access right now" }, 500);
  }

  if (!data) {
    return json({ allowed: false, message: "Email not found. Ask your admin to add you." }, 404);
  }

  return json({
    allowed: true,
    message: "Email recognized. Use the magic link that was sent to your inbox by your admin.",
  });
}
