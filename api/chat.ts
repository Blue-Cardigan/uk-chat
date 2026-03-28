import { convertToModelMessages, streamText } from "ai";
import { google } from "@ai-sdk/google";
import { createMCPClient } from "@ai-sdk/mcp";
import { getSupabaseAdmin, getUserFromRequest, json } from "./_lib/server";

export async function POST(request: Request) {
  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown chat error";
    return json({ error: message }, 500);
  }
}
