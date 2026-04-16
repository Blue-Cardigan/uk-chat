import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { UIMessage } from "ai";
import { apiFetch, apiFetchJson, ApiError } from "@/lib/api";
import { safeJson } from "@/lib/http";
import type { PersistedMessage } from "@/lib/types";
import { OPTIMISTIC_CHAT_ID_PREFIX } from "@/shared/chat-constants";

function isOptimisticConversationId(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(OPTIMISTIC_CHAT_ID_PREFIX);
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
      try {
        const payload = await apiFetchJson<{ messages?: PersistedMessage[] }>(
          `/api/conversations/${targetConversationId}`,
          { skipToast: true },
        );
        setMessages(mapMessages(payload.messages ?? []));
      } catch {
        // Silent; caller surfaces reactive errors separately.
      }
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
    void (async () => {
      try {
        const response = await apiFetch(`/api/conversations/${requestedConversationId}`, {
          signal: abortController.signal,
          skipToast: true,
        });
        const payload = (await safeJson<{ messages?: PersistedMessage[] }>(response)) ?? { messages: [] };
        if (abortController.signal.aborted) return;
        setMessages(mapMessages(payload.messages ?? []));
      } catch (error) {
        if (abortController.signal.aborted || error instanceof DOMException) return;
        if (error instanceof ApiError && error.status === 404) {
          await onMissingRef.current(requestedConversationId);
          return;
        }
        setConversationLoadError("Couldn't load this conversation. Try again or start a new chat.");
        setMessages([]);
      }
    })();
    return () => {
      abortController.abort();
    };
  }, [authToken, conversationId, pendingConversationId, setMessages, setPendingConversationId, liveSessionConversationIdRef]);

  return {
    loadConversationMessages,
    conversationLoadError,
  };
}
