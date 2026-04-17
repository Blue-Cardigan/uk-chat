import { useCallback, type CSSProperties, type KeyboardEvent, type Ref } from "react";
import type { ChatConversation } from "@/lib/types";

export function ConversationContextMenu({
  conversation,
  className,
  style,
  containerRef,
  onRename,
  onToggleStar,
  onShare,
  onUnshare,
  onDelete,
}: {
  conversation: ChatConversation;
  className?: string;
  style?: CSSProperties;
  containerRef?: Ref<HTMLDivElement>;
  onRename: () => void;
  onToggleStar: () => void;
  onShare: () => void;
  onUnshare: () => void;
  onDelete: () => void;
}) {
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
    const container = event.currentTarget;
    const items = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else if (key === "ArrowUp") nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    else if (key === "Home") nextIndex = 0;
    else if (key === "End") nextIndex = items.length - 1;
    items[nextIndex]?.focus();
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={style}
      role="menu"
      aria-label={`Actions for ${conversation.title}`}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        role="menuitem"
        className="w-full rounded px-2 py-1 text-left text-xs font-medium hover:bg-[color-mix(in_oklch,var(--color-foreground)_6%,transparent)]"
        onClick={onRename}
      >
        Rename
      </button>
      <button
        type="button"
        role="menuitem"
        className="w-full rounded px-2 py-1 text-left text-xs font-medium hover:bg-[color-mix(in_oklch,var(--color-foreground)_6%,transparent)]"
        onClick={onToggleStar}
      >
        {conversation.starred ? "Unstar" : "Star"}
      </button>
      <button
        type="button"
        role="menuitem"
        className="w-full rounded px-2 py-1 text-left text-xs font-medium hover:bg-[color-mix(in_oklch,var(--color-foreground)_6%,transparent)]"
        onClick={onShare}
      >
        {conversation.is_public && conversation.share_token ? "Copy share link" : "Share"}
      </button>
      {conversation.is_public ? (
        <button
          type="button"
          role="menuitem"
          className="w-full rounded px-2 py-1 text-left text-xs font-medium hover:bg-[color-mix(in_oklch,var(--color-foreground)_6%,transparent)]"
          onClick={onUnshare}
        >
          Stop sharing
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        className="w-full rounded px-2 py-1 text-left text-xs font-medium text-(--color-accent) hover:bg-[color-mix(in_oklch,var(--color-accent)_14%,transparent)]"
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}
