import { useCallback, useRef, useState } from "react";
import type { UIMessage } from "ai";
import type { ChatModelId } from "@/shared/chat-models";
import { apiFetch, ApiError } from "@/lib/api";

type Part = { type: string; [key: string]: unknown };

export type CouncilScope =
  | { kind: "postcode"; postcode: string }
  | { kind: "area"; area: string }
  | { kind: "national" };

function extractLatestCouncilIdFromMessages(inputMessages: UIMessage[]): string | null {
  const latestAssistant = [...inputMessages]
    .reverse()
    .find((message) => message.role === "assistant" && Array.isArray(message.parts));
  if (!latestAssistant || !Array.isArray(latestAssistant.parts)) return null;
  for (const part of latestAssistant.parts as Part[]) {
    if (!part.type?.startsWith("tool-") || !("output" in part)) continue;
    if (part.type.replace("tool-", "") !== "council_deliberation") continue;
    const output = part.output;
    if (!output || typeof output !== "object") continue;
    const id = (output as { councilId?: unknown }).councilId;
    if (typeof id === "string" && id.trim()) return id;
  }
  return null;
}

export function useCouncilMode(deps: {
  authToken: string | null;
  mcpToken: string | null;
  selectedModelId: ChatModelId;
  messages: UIMessage[];
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
  loadConversationMessages: (id: string) => Promise<void>;
  inferCouncilScope: (text: string) => Promise<CouncilScope>;
  onMcpTokenUnauthorized: () => void;
  onSubmitError: (message: string) => void;
  onPostComplete: () => void;
}): {
  councilPending: boolean;
  runCouncil: (params: { text: string; ensuredConversationId: string }) => boolean;
} {
  const {
    authToken,
    mcpToken,
    selectedModelId,
    messages,
    setMessages,
    loadConversationMessages,
    inferCouncilScope,
    onMcpTokenUnauthorized,
    onSubmitError,
    onPostComplete,
  } = deps;
  const [councilPending, setCouncilPending] = useState(false);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const inferCouncilScopeRef = useRef(inferCouncilScope);
  inferCouncilScopeRef.current = inferCouncilScope;
  const onMcpTokenUnauthorizedRef = useRef(onMcpTokenUnauthorized);
  onMcpTokenUnauthorizedRef.current = onMcpTokenUnauthorized;
  const onSubmitErrorRef = useRef(onSubmitError);
  onSubmitErrorRef.current = onSubmitError;
  const onPostCompleteRef = useRef(onPostComplete);
  onPostCompleteRef.current = onPostComplete;

  const runCouncil = useCallback(
    ({ text, ensuredConversationId }: { text: string; ensuredConversationId: string }): boolean => {
      if (!authToken || !mcpToken) return false;
      const optimisticMessageId = `optimistic-council-${crypto.randomUUID()}`;
      setMessages((current) => [
        ...current,
        {
          id: optimisticMessageId,
          role: "user",
          parts: [{ type: "text", text }],
        } as UIMessage,
      ]);
      setCouncilPending(true);

      const latestCouncilId = extractLatestCouncilIdFromMessages(messagesRef.current);

      if (latestCouncilId) {
        void (async () => {
          try {
            await apiFetch("/api/council/followup", {
              method: "POST",
              body: JSON.stringify({
                councilId: latestCouncilId,
                followUp: text,
                modelId: selectedModelId,
                mcpToken,
              }),
            });
            await loadConversationMessages(ensuredConversationId);
            setCouncilPending(false);
            onPostCompleteRef.current();
          } catch (error) {
            if (error instanceof ApiError && error.code === "MCP_TOKEN_UNAUTHORIZED") {
              onMcpTokenUnauthorizedRef.current();
            }
            onSubmitErrorRef.current(error instanceof Error ? error.message : "Failed to update council.");
            setMessages((current) => current.filter((message) => message.id !== optimisticMessageId));
            setCouncilPending(false);
          }
        })();
        return true;
      }

      void (async () => {
        try {
          const scope = await inferCouncilScopeRef.current(text);
          await apiFetch("/api/council", {
            method: "POST",
            body: JSON.stringify({
              conversationId: ensuredConversationId,
              issue: text,
              scope,
              modelId: selectedModelId,
              mcpToken,
            }),
          });
          await loadConversationMessages(ensuredConversationId);
          setCouncilPending(false);
          onPostCompleteRef.current();
        } catch (error) {
          if (error instanceof ApiError && error.code === "MCP_TOKEN_UNAUTHORIZED") {
            onMcpTokenUnauthorizedRef.current();
          }
          onSubmitErrorRef.current(error instanceof Error ? error.message : "Failed to create council.");
          setMessages((current) => current.filter((message) => message.id !== optimisticMessageId));
          setCouncilPending(false);
        }
      })();
      return true;
    },
    [authToken, mcpToken, selectedModelId, setMessages, loadConversationMessages],
  );

  return { councilPending, runCouncil };
}
