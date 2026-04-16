import { useCallback, useState } from "react";
import type { UIMessage } from "ai";
import type { ChatModelId } from "@/shared/chat-models";

type Part = { type: string; [key: string]: unknown };

export type CouncilScope =
  | { kind: "postcode"; postcode: string }
  | { kind: "area"; area: string }
  | { kind: "national" };

async function safeJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

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

      const latestCouncilId = extractLatestCouncilIdFromMessages(messages);

      if (latestCouncilId) {
        void (async () => {
          try {
            const followupResponse = await fetch("/api/council/followup", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${authToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                councilId: latestCouncilId,
                followUp: text,
                modelId: selectedModelId,
                mcpToken,
              }),
            });
            if (!followupResponse.ok) {
              const errorPayload = await safeJson<{ error?: string; code?: string }>(followupResponse);
              if (errorPayload?.code === "MCP_TOKEN_UNAUTHORIZED") onMcpTokenUnauthorized();
              onSubmitError(errorPayload?.error ?? `Failed to update council (${followupResponse.status})`);
              setMessages((current) => current.filter((message) => message.id !== optimisticMessageId));
              setCouncilPending(false);
              return;
            }
            await loadConversationMessages(ensuredConversationId);
            setCouncilPending(false);
            onPostComplete();
          } catch (error) {
            onSubmitError(error instanceof Error ? error.message : "Failed to update council.");
            setMessages((current) => current.filter((message) => message.id !== optimisticMessageId));
            setCouncilPending(false);
          }
        })();
        return true;
      }

      void (async () => {
        try {
          const scope = await inferCouncilScope(text);
          const createResponse = await fetch("/api/council", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${authToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              conversationId: ensuredConversationId,
              issue: text,
              scope,
              modelId: selectedModelId,
              mcpToken,
            }),
          });
          if (!createResponse.ok) {
            const errorPayload = await safeJson<{ error?: string; code?: string }>(createResponse);
            if (errorPayload?.code === "MCP_TOKEN_UNAUTHORIZED") onMcpTokenUnauthorized();
            onSubmitError(errorPayload?.error ?? `Failed to create council (${createResponse.status})`);
            setMessages((current) => current.filter((message) => message.id !== optimisticMessageId));
            setCouncilPending(false);
            return;
          }
          await loadConversationMessages(ensuredConversationId);
          setCouncilPending(false);
          onPostComplete();
        } catch (error) {
          onSubmitError(error instanceof Error ? error.message : "Failed to create council.");
          setMessages((current) => current.filter((message) => message.id !== optimisticMessageId));
          setCouncilPending(false);
        }
      })();
      return true;
    },
    [
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
    ],
  );

  return { councilPending, runCouncil };
}
