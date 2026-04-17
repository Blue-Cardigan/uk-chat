import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { UIMessage } from "ai";
import { AssistantThinkingMessage, Message } from "@/components/ai-elements/message";

type TrailingIndicator = "pre-conversation" | "thinking" | "council-thinking";

type VirtualizedMessageListProps = {
  messages: UIMessage[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  conversationKey: string;
  isStreaming: boolean;
  trailingIndicators: TrailingIndicator[];
};

export function VirtualizedMessageList({
  messages,
  scrollRef,
  conversationKey,
  isStreaming,
  trailingIndicators,
}: VirtualizedMessageListProps) {
  const items = useMemo(
    () => [
      ...messages.map((m) => ({ kind: "message" as const, message: m, key: m.id })),
      ...trailingIndicators.map((kind) => ({ kind, key: kind })),
    ],
    [messages, trailingIndicators],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 240,
    overscan: 4,
    getItemKey: (index) => items[index]?.key ?? index,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const prevConversationKey = useRef(conversationKey);
  const prevLastMessageSignature = useRef<string>("");

  useEffect(() => {
    if (prevConversationKey.current !== conversationKey) {
      prevConversationKey.current = conversationKey;
      prevLastMessageSignature.current = "";
      if (items.length > 0) {
        virtualizer.scrollToIndex(items.length - 1, { align: "end" });
      }
      return;
    }

    if (!isStreaming || messages.length === 0) return;

    const last = messages[messages.length - 1];
    if (last.role !== "assistant") return;
    const signature = `${messages.length}:${last.parts?.length ?? 0}:${JSON.stringify(
      last.parts?.[last.parts.length - 1] ?? null,
    ).length}`;
    if (signature === prevLastMessageSignature.current) return;
    prevLastMessageSignature.current = signature;
    virtualizer.scrollToIndex(items.length - 1, { align: "end" });
  }, [conversationKey, isStreaming, items.length, messages, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      style={{ height: totalSize, position: "relative", width: "100%" }}
    >
      {virtualItems.map((virtualRow) => {
        const item = items[virtualRow.index];
        if (!item) return null;
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
              paddingBottom: 12,
            }}
          >
            {item.kind === "message" ? <Message message={item.message} /> : <AssistantThinkingMessage />}
          </div>
        );
      })}
    </div>
  );
}
