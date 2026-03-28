import { getSupabaseAdmin, getUserFromRequest, json } from "../_lib/server";

function getId(request: Request) {
  return new URL(request.url).pathname.split("/").at(-1) ?? "";
}

export async function PATCH(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const id = getId(request);
  const { title } = (await request.json()) as { title?: string };
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("uk_chat_conversations")
    .update({ title: title?.trim() || "Untitled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id,title,created_at,updated_at")
    .single();
  if (error) return json({ error: error.message }, 400);
  return json(data);
}

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const id = getId(request);
  const supabase = getSupabaseAdmin();

  const { data: conversation, error: conversationError } = await supabase
    .from("uk_chat_conversations")
    .select("id,title,created_at,updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (conversationError) return json({ error: conversationError.message }, 404);

  const { data: messages, error: messageError } = await supabase
    .from("uk_chat_messages")
    .select("id,conversation_id,role,parts,created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });
  if (messageError) return json({ error: messageError.message }, 400);

  return json({ conversation, messages: messages ?? [] });
}

export async function DELETE(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const id = getId(request);
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("uk_chat_conversations").delete().eq("id", id).eq("user_id", user.id);
  if (error) return json({ error: error.message }, 400);
  return json({ success: true });
}
