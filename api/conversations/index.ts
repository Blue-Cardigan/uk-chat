import { getSupabaseAdmin, getUserFromRequest, json } from "../_lib/server";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("uk_chat_conversations")
    .select("id,title,created_at,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) return json({ error: error.message }, 400);
  return json(data ?? []);
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { title } = (await request.json()) as { title?: string };
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("uk_chat_conversations")
    .insert({ user_id: user.id, title: title?.trim() || "New chat" })
    .select("id,title,created_at,updated_at")
    .single();
  if (error) return json({ error: error.message }, 400);
  return json(data, 201);
}
