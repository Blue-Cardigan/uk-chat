import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { Conversation } from "@/components/ai-elements/conversation";
import { AssistantThinkingMessage, Message } from "@/components/ai-elements/message";
import { ChatInput, type ChatToolOption } from "@/components/chat/ChatInput";
import { SuggestedMessages } from "@/components/chat/SuggestedMessages";
import { DEFAULT_CHAT_MODEL_ID, type ChatModelId } from "@/lib/chat-models";
import { useAppStore } from "@/lib/store";
import { isChartArtifactCandidate } from "@/lib/viz-registry";
import { Input } from "@/components/ui/primitives";
import type { ChatConversation } from "@/lib/types";

type Part = { type: string; [key: string]: unknown };
type PersistedMessage = {
  id: string;
  role: "user" | "assistant";
  parts: Part[];
  created_at: string;
};
type ToolsCatalogResponse = {
  items?: ChatToolOption[];
  tools?: ChatToolOption[];
  totalCount?: number;
  nextOffset?: number | null;
  hasMore?: boolean;
};
type ModelUsageResponse = {
  banner: string | null;
  approaching: boolean;
  reached: boolean;
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
  const [selectedModelId, setSelectedModelId] = useState<ChatModelId>(DEFAULT_CHAT_MODEL_ID);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [toolsLoadingMore, setToolsLoadingMore] = useState(false);
  const [toolsQuery, setToolsQuery] = useState("");
  const [tools, setTools] = useState<ChatToolOption[]>([]);
  const [toolsTotalCount, setToolsTotalCount] = useState(0);
  const [toolsNextOffset, setToolsNextOffset] = useState<number | null>(0);
  const [toolsHasMore, setToolsHasMore] = useState(false);
  const [selectedTools, setSelectedTools] = useState<ChatToolOption[]>([]);
  const [usageBanner, setUsageBanner] = useState<string | null>(null);
  const onMissingRef = useRef(onConversationMissing);
  onMissingRef.current = onConversationMissing;

  const fetchToolsPage = useCallback(
    async ({
      query,
      offset,
      append,
      signal,
    }: {
      query: string;
      offset: number;
      append: boolean;
      signal: AbortSignal;
    }) => {
      if (!authToken || !mcpToken) return;
      const response = await fetch("/api/chat/tools", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mcpToken, query, offset, limit: 50 }),
        signal,
      });
      if (!response.ok) throw new Error(`Failed to load tools (${response.status})`);
      const payload = (await safeJson<ToolsCatalogResponse>(response)) ?? {};
      const incoming = payload.items ?? payload.tools ?? [];
      setTools((prev) => {
        if (!append) return incoming;
        const map = new Map(prev.map((tool) => [tool.name, tool] as const));
        incoming.forEach((tool) => map.set(tool.name, tool));
        return [...map.values()];
      });
      const totalCount = payload.totalCount ?? (append ? toolsTotalCount : incoming.length);
      const nextOffset = payload.nextOffset ?? null;
      const hasMore = payload.hasMore ?? nextOffset !== null;
      setToolsTotalCount(totalCount);
      setToolsNextOffset(nextOffset);
      setToolsHasMore(hasMore);
    },
    [authToken, mcpToken, toolsTotalCount],
  );

  useEffect(() => {
    if (!authToken || !mcpToken) {
      setTools([]);
      setToolsLoading(false);
      setToolsLoadingMore(false);
      setToolsHasMore(false);
      setToolsNextOffset(0);
      return;
    }
    const abortController = new AbortController();
    setToolsLoading(true);
    setToolsLoadingMore(false);
    setTools([]);
    setToolsNextOffset(0);
    setToolsHasMore(false);
    setToolsTotalCount(0);
    void fetchToolsPage({
      query: toolsQuery,
      offset: 0,
      append: false,
      signal: abortController.signal,
    })
      .catch(() => {
        if (abortController.signal.aborted) return;
        setTools([]);
        setToolsHasMore(false);
        setToolsNextOffset(null);
      })
      .finally(() => {
        if (!abortController.signal.aborted) setToolsLoading(false);
      });
    return () => abortController.abort();
  }, [authToken, mcpToken, fetchToolsPage, toolsQuery]);

  useEffect(() => {
    setSelectedTools((current) => current.filter((selected) => tools.some((tool) => tool.name === selected.name)));
  }, [tools]);

  useEffect(() => {
    setDraftTitle(conversation?.title ?? "");
    setEditingTitle(false);
  }, [conversation?.id, conversation?.title]);

  useEffect(() => {
    setSubmitError(null);
    void refreshUsageBanner();
  }, [selectedModelId]);

  useEffect(() => {
    if (!authToken) {
      setUsageBanner(null);
      return;
    }
    void refreshUsageBanner();
  }, [authToken]);

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
    onError: (error) => {
      setSubmitError(error.message || "Request failed. Please try again.");
    },
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
    const toolPrefix =
      selectedTools.length > 0
        ? `Use these tools when relevant: ${selectedTools.map((tool) => `/${tool.name}`).join(" ")}\n\n`
        : "";
    sendMessage(
      { text: `${toolPrefix}${text}` },
      {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        body: { conversationId: ensuredConversationId, mcpToken, modelId: selectedModelId },
      },
    );
    setSelectedTools([]);
    window.setTimeout(() => {
      void refreshUsageBanner();
    }, 1200);
  }

  function toggleToolSelection(tool: ChatToolOption) {
    setSelectedTools((current) => {
      const exists = current.some((selected) => selected.name === tool.name);
      if (exists) return current.filter((selected) => selected.name !== tool.name);
      return [...current, tool];
    });
  }

  function handleToolsQueryChange(query: string) {
    setToolsQuery(query);
  }

  function handleLoadMoreTools() {
    if (!authToken || !mcpToken) return;
    if (!toolsHasMore || toolsLoadingMore || toolsNextOffset == null) return;
    const abortController = new AbortController();
    setToolsLoadingMore(true);
    void fetchToolsPage({
      query: toolsQuery,
      offset: toolsNextOffset,
      append: true,
      signal: abortController.signal,
    }).finally(() => {
      setToolsLoadingMore(false);
    });
  }

  async function refreshUsageBanner() {
    if (!authToken) {
      setUsageBanner(null);
      return;
    }
    try {
      const response = await fetch(`/api/chat/usage?modelId=${encodeURIComponent(selectedModelId)}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) return;
      const payload = await safeJson<ModelUsageResponse>(response);
      setUsageBanner(payload?.banner ?? null);
    } catch {
      // Optional banner only; ignore transient failures.
    }
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
    (latest.parts as Part[]).forEach((part, index) => {
      let toolName: string | undefined;
      let toolCallId: string | undefined;
      let output: unknown;

      if (part.type === "tool-invocation") {
        const inv = (part as { toolInvocation?: { toolName: string; toolCallId: string; state: string; result?: unknown } }).toolInvocation;
        if (!inv || inv.state !== "result" || inv.result == null) return;
        toolName = inv.toolName;
        toolCallId = inv.toolCallId;
        output = inv.result;
      } else if (part.type.startsWith("tool-")) {
        if (part.state !== "output-available" || !("output" in part) || part.output == null) return;
        toolName = part.type.replace("tool-", "");
        toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : undefined;
        output = part.output;
      } else {
        return;
      }

      if (!toolName || !isChartArtifactCandidate(toolName, output)) return;
      const id = toolCallId ?? `idx-${index}`;
      pushVizPayload({
        id: `${latest.id}:${toolName}:${id}`,
        toolName,
        data: part,
        title: `Chart: ${toolName}`,
      });
    });
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

  const lastMessage = messages.at(-1);
  const hasAssistantContent =
    lastMessage?.role === "assistant" &&
    Array.isArray(lastMessage.parts) &&
    lastMessage.parts.some((part) => {
      if (part.type === "text") return typeof part.text === "string" && part.text.trim().length > 0;
      if (part.type === "reasoning") return true;
      if (part.type.startsWith("tool-")) return true;
      return false;
    });
  const showThinkingIndicator = (status === "submitted" || status === "streaming") && !hasAssistantContent;

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
            {showThinkingIndicator ? <AssistantThinkingMessage /> : null}
          </Conversation>
        )}
      </div>

      <div className="sticky bottom-0 bg-(--color-background) px-6 py-3 md:px-12">
        {usageBanner ? (
          <p className="mb-2 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">{usageBanner}</p>
        ) : null}
        {submitError ? <p className="mb-2 text-xs text-(--color-muted-foreground)">{submitError}</p> : null}
        <ChatInput
          onSubmit={(text) => void submitPrompt(text)}
          isStreaming={status === "streaming" || status === "submitted"}
          modelId={selectedModelId}
          onModelChange={setSelectedModelId}
          tools={tools}
          toolsLoading={toolsLoading}
          toolsHasMore={toolsHasMore}
          toolsLoadingMore={toolsLoadingMore}
          selectedTools={selectedTools}
          onToggleToolSelection={toggleToolSelection}
          onToolsQueryChange={handleToolsQueryChange}
          onLoadMoreTools={handleLoadMoreTools}
        />
      </div>
    </section>
  );
}
