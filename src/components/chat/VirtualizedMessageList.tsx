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

const NEAR_BOTTOM_THRESHOLD_PX = 120;

function lastPartTailSignature(message: UIMessage): string {
  const parts = message.parts ?? [];
  const last = parts[parts.length - 1] as
    | { type?: string; text?: unknown; state?: unknown; output?: unknown }
    | undefined;
  if (!last) return "";
  const type = typeof last.type === "string" ? last.type : "";
  const textLen = typeof last.text === "string" ? last.text.length : 0;
  const state = typeof last.state === "string" ? last.state : "";
  const hasOutput = last.output != null ? 1 : 0;
  return `${type}:${textLen}:${state}:${hasOutput}`;
}

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
    overscan: 6,
    getItemKey: (index) => items[index]?.key ?? index,
  });

  const prevConversationKey = useRef(conversationKey);
  const prevLastMessageSignature = useRef<string>("");
  const stickToBottomRef = useRef<boolean>(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function handleScroll() {
      if (!el) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
    }
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [scrollRef]);

  useEffect(() => {
    if (prevConversationKey.current !== conversationKey) {
      prevConversationKey.current = conversationKey;
      prevLastMessageSignature.current = "";
      stickToBottomRef.current = true;
      if (items.length > 0) {
        virtualizer.scrollToIndex(items.length - 1, { align: "end" });
      }
      return;
    }

    if (!isStreaming || messages.length === 0) return;

    const last = messages[messages.length - 1];
    if (last.role !== "assistant") return;
    const signature = `${messages.length}:${last.parts?.length ?? 0}:${lastPartTailSignature(last)}`;
    if (signature === prevLastMessageSignature.current) return;
    prevLastMessageSignature.current = signature;
    if (!stickToBottomRef.current) return;
    virtualizer.scrollToIndex(items.length - 1, { align: "end" });
  }, [conversationKey, isStreaming, items.length, messages, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div style={{ height: totalSize, position: "relative", width: "100%" }}>
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
