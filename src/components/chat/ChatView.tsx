import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { Conversation } from "@/components/ai-elements/conversation";
import { Message } from "@/components/ai-elements/message";
import { ChatInput } from "@/components/chat/ChatInput";
import { SuggestedMessages } from "@/components/chat/SuggestedMessages";
import { useAppStore } from "@/lib/store";
import { Input } from "@/components/ui/primitives";
import type { ChatConversation } from "@/lib/types";

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
  conversation,
  conversationId,
  mcpToken,
  authToken,
  onEnsureConversation,
  onRenameConversation,
  onConversationMissing,
}: {
  conversation: ChatConversation | null;
  conversationId: string | null;
  mcpToken: string | null;
  authToken: string | null;
  onEnsureConversation: () => Promise<string | null>;
  onRenameConversation: (id: string, title: string) => void;
  onConversationMissing: (id: string) => Promise<void> | void;
}) {
  const pushVizPayload = useAppStore((state) => state.pushVizPayload);
  const clearVizPayloads = useAppStore((state) => state.clearVizPayloads);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const onMissingRef = useRef(onConversationMissing);
  onMissingRef.current = onConversationMissing;

  useEffect(() => {
    setDraftTitle(conversation?.title ?? "");
    setEditingTitle(false);
  }, [conversation?.id, conversation?.title]);

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
    const requestedConversationId = conversationId;
    const abortController = new AbortController();
    fetch(`/api/conversations/${requestedConversationId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: abortController.signal,
    })
      .then(async (response) => {
        if (response.status === 404) {
          await onMissingRef.current(requestedConversationId);
          return null;
        }
        if (!response.ok) throw new Error(`Failed to load conversation (${response.status})`);
        return (await safeJson<{ messages?: PersistedMessage[] }>(response)) ?? { messages: [] };
      })
      .then((payload) => {
        if (abortController.signal.aborted || !payload) return;
        const mapped: UIMessage[] = (payload.messages ?? []).map((message) => ({
          id: message.id,
          role: message.role === "assistant" ? "assistant" : "user",
          parts: (message.parts ?? []) as UIMessage["parts"],
        }));
        setMessages(mapped);
      })
      .catch((error) => {
        if (abortController.signal.aborted || error instanceof DOMException) return;
        setMessages([]);
      });
    return () => {
      abortController.abort();
    };
  }, [authToken, clearVizPayloads, conversationId, setMessages]);

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

  function submitTitleRename() {
    if (!conversation) return;
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed === conversation.title.trim()) {
      setEditingTitle(false);
      setDraftTitle(conversation.title);
      return;
    }
    onRenameConversation(conversation.id, trimmed);
    setEditingTitle(false);
  }

  return (
    <section className="flex h-full flex-col">
      <div className="sticky top-0 z-20 bg-(--color-background)/95 px-6 py-3 backdrop-blur-sm md:px-12">
        <div className="flex items-center gap-3">
          {editingTitle && conversation ? (
            <form
              className="min-w-0 flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                submitTitleRename();
              }}
            >
              <Input
                value={draftTitle}
                className="h-8 text-sm"
                onChange={(event) => setDraftTitle(event.target.value)}
                onBlur={submitTitleRename}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setEditingTitle(false);
                    setDraftTitle(conversation.title);
                  }
                }}
                autoFocus
              />
            </form>
          ) : (
            <button
              type="button"
              className="min-w-0 truncate text-left text-sm font-medium hover:opacity-80"
              onClick={() => {
                if (!conversation) return;
                setDraftTitle(conversation.title);
                setEditingTitle(true);
              }}
              disabled={!conversation}
              aria-label={conversation ? "Rename conversation" : "Conversation title"}
            >
              {conversation?.title ?? "New conversation"}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 md:px-12">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl space-y-4 pt-[20vh]">
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
      </div>

      <div className="sticky bottom-0 border-t border-(--color-border) bg-(--color-background) px-6 py-3 md:px-12">
        {submitError ? <p className="mb-2 text-xs text-(--color-muted-foreground)">{submitError}</p> : null}
        <ChatInput onSubmit={(text) => void submitPrompt(text)} isStreaming={status === "streaming" || status === "submitted"} />
      </div>
    </section>
  );
}
