import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { UIMessage } from "ai";

type Part = { type: string; [key: string]: unknown };
type PersistedMessage = {
  id: string;
  role: "user" | "assistant";
  parts: Part[];
  created_at: string;
};

const OPTIMISTIC_CHAT_ID_PREFIX = "optimistic-chat-";

function isOptimisticConversationId(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(OPTIMISTIC_CHAT_ID_PREFIX);
}

async function safeJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function mapMessages(messages: PersistedMessage[]): UIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role === "assistant" ? "assistant" : "user",
    parts: (message.parts ?? []) as UIMessage["parts"],
  }));
}

/**
 * Loads conversation messages both reactively (when conversationId changes)
 * and on demand via `loadConversationMessages`.
 *
 * `liveSessionConversationIdRef` is a caller-owned ref that prevents the
 * reactive loader from overwriting optimistic in-flight messages. When it
 * points at the active conversation, the reactive load is skipped.
 *
 * `onReset` fires when the reactive loader wipes messages (conversation
 * switch) so callers can clear artifact-dedup bookkeeping.
 */
export function useMessageLoader(params: {
  authToken: string | null;
  conversationId: string | null;
  pendingConversationId: string | null;
  setMessages: (messages: UIMessage[]) => void;
  setPendingConversationId: (value: string | null) => void;
  liveSessionConversationIdRef: MutableRefObject<string | null>;
  onConversationMissing: (id: string) => Promise<void> | void;
  onReset?: () => void;
}): {
  loadConversationMessages: (id: string) => Promise<void>;
  conversationLoadError: string | null;
  clearConversationLoadError: () => void;
} {
  const {
    authToken,
    conversationId,
    pendingConversationId,
    setMessages,
    setPendingConversationId,
    liveSessionConversationIdRef,
    onConversationMissing,
    onReset,
  } = params;

  const [conversationLoadError, setConversationLoadError] = useState<string | null>(null);
  const onMissingRef = useRef(onConversationMissing);
  onMissingRef.current = onConversationMissing;
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  const loadConversationMessages = useCallback(
    async (targetConversationId: string) => {
      if (!authToken) return;
      const response = await fetch(`/api/conversations/${targetConversationId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) return;
      const payload = (await safeJson<{ messages?: PersistedMessage[] }>(response)) ?? { messages: [] };
      setMessages(mapMessages(payload.messages ?? []));
    },
    [authToken, setMessages],
  );

  useEffect(() => {
    onResetRef.current?.();
    setConversationLoadError(null);
    const activeConversationId = conversationId ?? pendingConversationId;
    if (!authToken) {
      setMessages([]);
      return;
    }
    if (!activeConversationId) {
      setPendingConversationId(null);
      setMessages([]);
      return;
    }
    if (!conversationId && pendingConversationId) {
      // Keep optimistic/prefetched messages while parent conversation state catches up.
      return;
    }
    if (!conversationId) {
      setMessages([]);
      return;
    }
    const requestedConversationId = activeConversationId;
    if (isOptimisticConversationId(requestedConversationId)) return;
    if (liveSessionConversationIdRef.current === requestedConversationId) return;

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
        setMessages(mapMessages(payload.messages ?? []));
      })
      .catch((error) => {
        if (abortController.signal.aborted || error instanceof DOMException) return;
        setConversationLoadError("Couldn't load this conversation. Try again or start a new chat.");
        setMessages([]);
      });
    return () => {
      abortController.abort();
    };
  }, [authToken, conversationId, pendingConversationId, setMessages, setPendingConversationId, liveSessionConversationIdRef]);

  return {
    loadConversationMessages,
    conversationLoadError,
    clearConversationLoadError: () => setConversationLoadError(null),
  };
}
