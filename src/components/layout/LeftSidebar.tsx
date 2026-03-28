import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, PanelLeftClose, Plus, Settings, Star } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import type { ChatConversation } from "@/lib/types";
import { cn } from "@/lib/utils";

export function LeftSidebar({
  conversations,
  activeConversationId,
  onCreate,
  onSelect,
  onDelete,
  onRename,
  onToggleStar,
  onShare,
  onCollapse,
  onToggleSettings,
}: {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  onCreate: () => Promise<string | null>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onToggleStar: (id: string, starred: boolean) => void;
  onShare: (conversation: ChatConversation) => void;
  onCollapse: () => void;
  onToggleSettings: () => void;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const conversationById = useMemo(() => new Map(conversations.map((conversation) => [conversation.id, conversation])), [conversations]);
  const starredConversations = useMemo(() => conversations.filter((conversation) => conversation.starred), [conversations]);
  const recentConversations = useMemo(() => conversations.filter((conversation) => !conversation.starred), [conversations]);

  useEffect(() => {
    if (!openMenuId && !editingId) return;

    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      setOpenMenuId(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenMenuId(null);
      setEditingId(null);
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [editingId, openMenuId]);

  function startRename(id: string) {
    const conversation = conversationById.get(id);
    if (!conversation) return;
    setDraftTitle(conversation.title);
    setEditingId(id);
    setOpenMenuId(null);
  }

  function submitRename(id: string) {
    const trimmed = draftTitle.trim();
    const current = conversationById.get(id)?.title?.trim() ?? "";
    if (trimmed && trimmed !== current) onRename(id, trimmed);
    setEditingId(null);
  }

  function renderConversation(conversation: ChatConversation) {
    const isActive = conversation.id === activeConversationId;
    const isEditing = editingId === conversation.id;
    const isMenuOpen = openMenuId === conversation.id;

    return (
      <div
        key={conversation.id}
        className={cn("animate-[slideUp_200ms_ease-out_both] transition-colors duration-200 ease-out", isActive ? "border-(--color-primary)" : "")}
      >
        <div
          className={cn(
            "group relative flex items-center gap-1 rounded-md px-2 py-2 sm:py-1 transition-colors duration-200 ease-out",
            isMenuOpen ? "z-30" : "z-0",
            isActive
              ? "bg-[color-mix(in_oklch,var(--color-primary)_14%,var(--color-sidebar)_86%)]"
              : isMenuOpen
                ? ""
                : "hover:bg-[color-mix(in_oklch,var(--color-foreground)_6%,transparent)]",
          )}
        >
          {isEditing ? (
            <form
              className="min-w-0 flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                submitRename(conversation.id);
              }}
            >
              <Input
                value={draftTitle}
                className="h-8 text-xs"
                onChange={(event) => setDraftTitle(event.target.value)}
                onBlur={() => submitRename(conversation.id)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setEditingId(null);
                  }
                }}
                autoFocus
              />
            </form>
          ) : (
            <button
              type="button"
              className={cn(
                "min-w-0 flex-1 truncate py-1 text-left text-sm",
                isActive ? "font-semibold text-(--color-foreground)" : "font-medium text-(--color-foreground)",
              )}
              onClick={() => {
                setOpenMenuId(null);
                setEditingId(null);
                onSelect(conversation.id);
              }}
            >
              {conversation.title}
            </button>
          )}

          <Button
            variant="ghost"
            className={cn(
              "h-7 w-7 p-0 transition-opacity",
              conversation.starred ? "opacity-100 text-amber-400" : "opacity-0 group-hover:opacity-100 focus:opacity-100",
            )}
            aria-label={conversation.starred ? `Unstar ${conversation.title}` : `Star ${conversation.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleStar(conversation.id, !conversation.starred);
            }}
          >
            <Star className="h-4 w-4" fill={conversation.starred ? "currentColor" : "none"} />
          </Button>

          <Button
            variant="ghost"
            className={cn(
              "h-7 w-7 p-0 transition-opacity",
              isMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100",
            )}
            aria-label={`Open actions for ${conversation.title}`}
            onClick={(event) => {
              event.stopPropagation();
              setOpenMenuId((current) => (current === conversation.id ? null : conversation.id));
            }}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>

          {isMenuOpen ? (
            <div ref={menuRef} className="absolute right-0 top-10 z-50 min-w-40 rounded-md border border-(--color-border) bg-(--color-card) p-1 shadow-xl">
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-xs font-medium hover:bg-[color-mix(in_oklch,var(--color-foreground)_6%,transparent)]"
                onClick={() => startRename(conversation.id)}
              >
                Rename
              </button>
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-xs font-medium hover:bg-[color-mix(in_oklch,var(--color-foreground)_6%,transparent)]"
                onClick={() => {
                  onToggleStar(conversation.id, !conversation.starred);
                  setOpenMenuId(null);
                }}
              >
                {conversation.starred ? "Unstar" : "Star"}
              </button>
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-xs font-medium hover:bg-[color-mix(in_oklch,var(--color-foreground)_6%,transparent)]"
                onClick={() => {
                  onShare(conversation);
                  setOpenMenuId(null);
                }}
              >
                {conversation.is_public && conversation.share_token ? "Copy share link" : "Share"}
              </button>
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-xs font-medium text-(--color-accent) hover:bg-[color-mix(in_oklch,var(--color-accent)_14%,transparent)]"
                onClick={() => onDelete(conversation.id)}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <aside className="flex h-full w-full flex-col gap-3 border-r border-(--color-border) bg-(--color-sidebar) p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="h-8 w-8 p-0" aria-label="Collapse sidebar" onClick={onCollapse}>
            <PanelLeftClose className="h-4 w-4" />
          </Button>
          <span className="font-display text-sm font-semibold">ETK Chat</span>
        </div>
        <Button variant="ghost" className="h-8 w-8 p-0" onClick={onCreate} aria-label="New chat">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {starredConversations.length > 0 ? (
          <div className="space-y-1">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Starred</p>
            {starredConversations.map(renderConversation)}
          </div>
        ) : null}
        {recentConversations.length > 0 ? (
          <div className="space-y-1">
            {starredConversations.length > 0 ? (
              <p className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Recent</p>
            ) : null}
            {recentConversations.map(renderConversation)}
          </div>
        ) : null}
      </div>

      <div className="border-t border-(--color-border) pt-2">
        <Button
          variant="ghost"
          className="group w-full justify-start gap-2 text-sm text-(--color-muted-foreground) transition-colors hover:text-(--color-foreground)"
          onClick={onToggleSettings}
        >
          <Settings className="h-4 w-4 transition-transform duration-200 ease-out group-hover:rotate-45" />
          Settings
        </Button>
      </div>
    </aside>
  );
}
