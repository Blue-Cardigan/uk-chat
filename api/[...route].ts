import { convertToModelMessages, streamText } from "ai";
import { google } from "@ai-sdk/google";
import { createMCPClient } from "@ai-sdk/mcp";
import { onboardUser } from "./_lib/onboarding.js";
import { ensureAdmin, ensureAdminOrBootstrap, getSupabaseAdmin, getUserFromRequest, json } from "./_lib/server.js";

function pathParts(request: Request) {
  const pathname = new URL(request.url).pathname;
  return pathname.split("/").filter(Boolean);
}

function getConversationId(request: Request) {
  const parts = pathParts(request);
  return parts.length >= 3 ? parts[2] ?? "" : "";
}

async function handleChat(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const body = (await request.json()) as {
    messages?: Array<{ role?: string; parts?: unknown[] }>;
    mcpToken?: string | null;
    conversationId?: string | null;
  };
  const supabase = getSupabaseAdmin();
  const { data: profile } = await supabase.from("uk_chat_profiles").select("mcp_token").eq("id", user.id).single();
  const token = body.mcpToken ?? profile?.mcp_token;
  if (!token) return json({ error: "Missing MCP token" }, 400);
  if (!body.conversationId) return json({ error: "Missing conversationId" }, 400);
  const { data: conversation } = await supabase
    .from("uk_chat_conversations")
    .select("id")
    .eq("id", body.conversationId)
    .eq("user_id", user.id)
    .single();
  if (!conversation) return json({ error: "Conversation not found" }, 404);

  const mcpClient = await createMCPClient({
    transport: {
      type: "sse",
      url: "https://mcp.explorethekingdom.co.uk",
      headers: { Authorization: `Bearer ${token}` },
    },
  });
  const tools = await mcpClient.tools();

  const latestUserMessage = [...(body.messages ?? [])].reverse().find((message) => message.role === "user");
  if (latestUserMessage) {
    await supabase.from("uk_chat_messages").insert({
      conversation_id: body.conversationId,
      role: "user",
      parts: latestUserMessage.parts ?? [],
    });
  }

  const result = streamText({
    model: google("gemini-3-flash-preview"),
    messages: await convertToModelMessages((body.messages ?? []) as Parameters<typeof convertToModelMessages>[0]),
    tools,
    system: `You are a UK data analyst. Answer with precision and cite the relevant data source/tool.
Use geography codes and UK postcodes carefully. Prefer tool calls when factual data is needed.`,
    onFinish: async (event) => {
      await supabase.from("uk_chat_messages").insert({
        conversation_id: body.conversationId!,
        role: "assistant",
        parts: [{ type: "text", text: event.text }],
      });
      await supabase
        .from("uk_chat_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", body.conversationId!)
        .eq("user_id", user.id);
    },
  });

  return result.toUIMessageStreamResponse();
}

async function handleConversationsIndex(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const supabase = getSupabaseAdmin();

  if (request.method === "GET") {
    const { data, error } = await supabase
      .from("uk_chat_conversations")
      .select("id,title,created_at,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) return json({ error: error.message }, 400);
    return json(data ?? []);
  }

  if (request.method === "POST") {
    const { title } = (await request.json()) as { title?: string };
    const { data, error } = await supabase
      .from("uk_chat_conversations")
      .insert({ user_id: user.id, title: title?.trim() || "New chat" })
      .select("id,title,created_at,updated_at")
      .single();
    if (error) return json({ error: error.message }, 400);
    return json(data, 201);
  }

  return json({ error: "Method not allowed" }, 405);
}

async function handleConversationById(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const id = getConversationId(request);
  const supabase = getSupabaseAdmin();

  if (request.method === "PATCH") {
    const { title } = (await request.json()) as { title?: string };
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

  if (request.method === "GET") {
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

  if (request.method === "DELETE") {
    const { error } = await supabase.from("uk_chat_conversations").delete().eq("id", id).eq("user_id", user.id);
    if (error) return json({ error: error.message }, 400);
    return json({ success: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function handleCheckEmail(request: Request) {
  const { email } = (await request.json()) as { email?: string };
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return json({ error: "Email is required" }, 400);
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("uk_chat_email_gate").select("email").eq("email", normalizedEmail).maybeSingle();
  if (error) return json({ error: "Unable to verify email access right now" }, 500);
  if (!data) return json({ allowed: false, message: "Email not found. Ask your admin to add you." }, 404);

  return json({
    allowed: true,
    message: "Email recognized. Use the magic link that was sent to your inbox by your admin.",
  });
}

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

async function handleAdminUsers(request: Request) {
  const admin = await ensureAdmin(request);
  if ("error" in admin) return admin.error;

  if (request.method === "GET") {
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

  if (request.method === "POST") {
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

  return json({ error: "Method not allowed" }, 405);
}

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

async function handleAdminTokens(request: Request) {
  const admin = await ensureAdmin(request);
  if ("error" in admin) return admin.error;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

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

async function handleAdminOnboardUser(request: Request) {
  const auth = await ensureAdminOrBootstrap(request);
  if ("error" in auth) return auth.error;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = (await request.json()) as {
    email?: string;
    sendEmail?: boolean;
    token?: string;
    rotateToken?: boolean;
  };
  if (!body.email) return json({ error: "Email is required" }, 400);

  try {
    const result = await onboardUser({
      email: body.email,
      sendEmail: body.sendEmail,
      token: body.token,
      rotateToken: body.rotateToken,
    });
    return json({
      message: "User onboarding completed",
      user: {
        email: result.email,
        status: "invited",
        hasToken: Boolean(result.token),
      },
      meta: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Onboarding failed";
    return json({ error: message }, 400);
  }
}

function methodNotAllowed() {
  return json({ error: "Method not allowed" }, 405);
}

async function routeRequest(request: Request) {
  const parts = pathParts(request);
  if (parts[0] !== "api") return json({ error: "Not found" }, 404);

  if (parts.length === 1) {
    if (request.method === "GET") return json({ ok: true });
    return methodNotAllowed();
  }

  if (parts[1] === "chat") {
    if (request.method !== "POST") return methodNotAllowed();
    return handleChat(request);
  }

  if (parts[1] === "conversations") {
    if (parts.length === 2) return handleConversationsIndex(request);
    if (parts.length === 3) return handleConversationById(request);
    return json({ error: "Not found" }, 404);
  }

  if (parts[1] === "auth") {
    if (parts[2] === "check-email") {
      if (request.method !== "POST") return methodNotAllowed();
      return handleCheckEmail(request);
    }
    if (parts[2] === "callback") {
      if (request.method !== "GET") return methodNotAllowed();
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  }

  if (parts[1] === "admin") {
    if (parts[2] === "users") return handleAdminUsers(request);
    if (parts[2] === "tokens") return handleAdminTokens(request);
    if (parts[2] === "onboard-user") return handleAdminOnboardUser(request);
    return json({ error: "Not found" }, 404);
  }

  return json({ error: "Not found" }, 404);
}

export async function GET(request: Request) {
  return routeRequest(request);
}

export async function POST(request: Request) {
  return routeRequest(request);
}

export async function PATCH(request: Request) {
  return routeRequest(request);
}

export async function DELETE(request: Request) {
  return routeRequest(request);
}
