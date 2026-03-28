import { useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { Conversation } from "@/components/ai-elements/conversation";
import { Message } from "@/components/ai-elements/message";
import { ChatInput } from "@/components/chat/ChatInput";
import { SuggestedMessages } from "@/components/chat/SuggestedMessages";
import { Card } from "@/components/ui/primitives";
import { useAppStore } from "@/lib/store";

type Part = { type: string; [key: string]: unknown };
type PersistedMessage = {
  id: string;
  role: "user" | "assistant";
  parts: Part[];
  created_at: string;
};

async function safeJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function ChatView({
  conversationId,
  mcpToken,
  authToken,
  onEnsureConversation,
  onConversationMissing,
}: {
  conversationId: string | null;
  mcpToken: string | null;
  authToken: string | null;
  onEnsureConversation: () => Promise<string | null>;
  onConversationMissing: () => void;
}) {
  const pushVizPayload = useAppStore((state) => state.pushVizPayload);
  const clearVizPayloads = useAppStore((state) => state.clearVizPayloads);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });

  async function submitPrompt(text: string) {
    setSubmitError(null);
    if (!authToken) {
      setSubmitError("You need to sign in before sending a message.");
      return;
    }
    if (!mcpToken) {
      setSubmitError("Your access token is still being prepared. Please try again in a few seconds.");
      return;
    }
    const ensuredConversationId = conversationId ?? (await onEnsureConversation());
    if (!ensuredConversationId) {
      setSubmitError("Could not create a conversation. Please try again.");
      return;
    }
    sendMessage(
      { text },
      {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        body: { conversationId: ensuredConversationId, mcpToken },
      },
    );
  }

  useEffect(() => {
    clearVizPayloads();
    if (!conversationId || !authToken) {
      setMessages([]);
      return;
    }
    fetch(`/api/conversations/${conversationId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (response) => {
        if (response.status === 404) {
          onConversationMissing();
          return { messages: [] };
        }
        if (!response.ok) throw new Error(`Failed to load conversation (${response.status})`);
        return (await safeJson<{ messages?: PersistedMessage[] }>(response)) ?? { messages: [] };
      })
      .then((payload) => {
        const mapped: UIMessage[] = (payload.messages ?? []).map((message) => ({
          id: message.id,
          role: message.role === "assistant" ? "assistant" : "user",
          parts: (message.parts ?? []) as UIMessage["parts"],
        }));
        setMessages(mapped);
      })
      .catch(() => setMessages([]));
  }, [authToken, clearVizPayloads, conversationId, onConversationMissing, setMessages]);

  useEffect(() => {
    const latest = messages.at(-1);
    if (!latest?.parts) return;
    for (const part of latest.parts as Part[]) {
      if (!part.type.startsWith("tool-")) continue;
      pushVizPayload({
        id: `${latest.id}:${part.type}`,
        toolName: part.type.replace("tool-", ""),
        data: part,
        title: `Tool: ${part.type.replace("tool-", "")}`,
      });
    }
  }, [messages, pushVizPayload]);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="flex min-h-0 flex-1 flex-col gap-3">
        {messages.length === 0 ? (
          <div className="space-y-4">
            <h2 className="font-display text-2xl">Ask a UK question</h2>
            <p className="text-sm text-(--color-muted-foreground)">
              Answers are grounded in live UK data tools and rendered with maps, dashboards, and synthetic personas.
            </p>
            <SuggestedMessages onPick={(text) => void submitPrompt(text)} />
          </div>
        ) : (
          <Conversation>
            {messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
          </Conversation>
        )}
      </Card>
      {submitError ? <p className="text-xs text-(--color-muted-foreground)">{submitError}</p> : null}
      <ChatInput onSubmit={(text) => void submitPrompt(text)} isStreaming={status === "streaming" || status === "submitted"} />
    </section>
  );
}
