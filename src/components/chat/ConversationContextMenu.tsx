import type { Ref } from "react";
import type { ChatConversation } from "@/lib/types";

export function ConversationContextMenu({
  conversation,
  className,
  containerRef,
  onRename,
  onToggleStar,
  onShare,
  onUnshare,
  onDelete,
}: {
  conversation: ChatConversation;
  className?: string;
  containerRef?: Ref<HTMLDivElement>;
  onRename: () => void;
  onToggleStar: () => void;
  onShare: () => void;
  onUnshare: () => void;
  onDelete: () => void;
}) {
  return (
    <div ref={containerRef} className={className}>
      <button
        type="button"
        className="w-full rounded px-2 py-1 text-left text-xs font-medium hover:bg-[color-mix(in_oklch,var(--color-foreground)_6%,transparent)]"
        onClick={onRename}
      >
        Rename
      </button>
      <button
        type="button"
        className="w-full rounded px-2 py-1 text-left text-xs font-medium hover:bg-[color-mix(in_oklch,var(--color-foreground)_6%,transparent)]"
        onClick={onToggleStar}
      >
        {conversation.starred ? "Unstar" : "Star"}
      </button>
      <button
        type="button"
        className="w-full rounded px-2 py-1 text-left text-xs font-medium hover:bg-[color-mix(in_oklch,var(--color-foreground)_6%,transparent)]"
        onClick={onShare}
      >
        {conversation.is_public && conversation.share_token ? "Copy share link" : "Share"}
      </button>
      {conversation.is_public ? (
        <button
          type="button"
          className="w-full rounded px-2 py-1 text-left text-xs font-medium hover:bg-[color-mix(in_oklch,var(--color-foreground)_6%,transparent)]"
          onClick={onUnshare}
        >
          Stop sharing
        </button>
      ) : null}
      <button
        type="button"
        className="w-full rounded px-2 py-1 text-left text-xs font-medium text-(--color-accent) hover:bg-[color-mix(in_oklch,var(--color-accent)_14%,transparent)]"
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}
