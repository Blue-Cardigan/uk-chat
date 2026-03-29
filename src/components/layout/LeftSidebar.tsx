import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, PanelLeftClose, Plus, Search, Settings, Star } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import type { ChatConversation } from "@/lib/types";
import { cn } from "@/lib/utils";

const DEFAULT_VISIBLE_COUNT = 25;
const VISIBLE_COUNT_STEP = 25;

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
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleStarredCount, setVisibleStarredCount] = useState(DEFAULT_VISIBLE_COUNT);
  const [visibleRecentCount, setVisibleRecentCount] = useState(DEFAULT_VISIBLE_COUNT);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const conversationById = useMemo(() => new Map(conversations.map((conversation) => [conversation.id, conversation])), [conversations]);
  const starredConversations = useMemo(() => conversations.filter((conversation) => conversation.starred), [conversations]);
  const recentConversations = useMemo(() => conversations.filter((conversation) => !conversation.starred), [conversations]);
  const normalizedSearchQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);
  const filteredStarredConversations = useMemo(() => {
    if (!normalizedSearchQuery) return starredConversations;
    return starredConversations.filter((conversation) => conversation.title.toLowerCase().includes(normalizedSearchQuery));
  }, [normalizedSearchQuery, starredConversations]);
  const filteredRecentConversations = useMemo(() => {
    if (!normalizedSearchQuery) return recentConversations;
    return recentConversations.filter((conversation) => conversation.title.toLowerCase().includes(normalizedSearchQuery));
  }, [normalizedSearchQuery, recentConversations]);
  const visibleStarredConversations = useMemo(
    () => filteredStarredConversations.slice(0, visibleStarredCount),
    [filteredStarredConversations, visibleStarredCount],
  );
  const visibleRecentConversations = useMemo(
    () => filteredRecentConversations.slice(0, visibleRecentCount),
    [filteredRecentConversations, visibleRecentCount],
  );
  const hasChatMatches = filteredStarredConversations.length + filteredRecentConversations.length > 0;

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

  useEffect(() => {
    setVisibleStarredCount(DEFAULT_VISIBLE_COUNT);
    setVisibleRecentCount(DEFAULT_VISIBLE_COUNT);
  }, [normalizedSearchQuery]);

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
        className={cn(
          "relative animate-[slideUp_200ms_ease-out_both] transition-colors duration-200 ease-out",
          isMenuOpen ? "z-40" : "z-0",
          isActive ? "border-(--color-primary)" : "",
        )}
      >
        <div
          className={cn(
            "group relative flex items-center gap-1 rounded-md px-2 py-2 sm:py-1 transition-colors duration-200 ease-out",
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
            <div
              ref={menuRef}
              className="absolute right-0 top-10 z-120 min-w-40 rounded-md border border-(--color-border) bg-(--color-background) p-1 shadow-xl"
            >
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
    <aside className="flex h-full min-h-0 w-full flex-col gap-3 border-r border-(--color-border) bg-(--color-sidebar) p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="font-display text-lg font-semibold">
            Chat
            <span className="text-(--color-accent)">G</span>
            <span className="text-(--color-primary)">B</span>
          </span>
        </div>
        <Button
          variant="ghost"
          className="h-8 w-8 p-0"
          aria-label="Collapse sidebar"
          onClick={onCollapse}
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex items-start mt-1 mb-1">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-sm"
          onClick={onCreate}
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" />
          New chat
        </Button>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--color-muted-foreground)" />
        <Input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="h-8 pl-8 text-xs"
          placeholder="Search chats"
          aria-label="Search chats"
        />
      </div>
      <div className="relative isolate flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {filteredStarredConversations.length > 0 ? (
          <div className="space-y-1">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Starred</p>
            {visibleStarredConversations.map(renderConversation)}
            {visibleStarredConversations.length < filteredStarredConversations.length ? (
              <Button
                variant="ghost"
                className="h-7 w-full justify-start px-2 text-xs text-(--color-muted-foreground)"
                onClick={() => setVisibleStarredCount((current) => current + VISIBLE_COUNT_STEP)}
              >
                Show more ({filteredStarredConversations.length - visibleStarredConversations.length} remaining)
              </Button>
            ) : null}
          </div>
        ) : null}
        {filteredRecentConversations.length > 0 ? (
          <div className="space-y-1">
            {filteredStarredConversations.length > 0 ? (
              <p className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Recent</p>
            ) : null}
            {visibleRecentConversations.map(renderConversation)}
            {visibleRecentConversations.length < filteredRecentConversations.length ? (
              <Button
                variant="ghost"
                className="h-7 w-full justify-start px-2 text-xs text-(--color-muted-foreground)"
                onClick={() => setVisibleRecentCount((current) => current + VISIBLE_COUNT_STEP)}
              >
                Show more ({filteredRecentConversations.length - visibleRecentConversations.length} remaining)
              </Button>
            ) : null}
          </div>
        ) : null}
        {!hasChatMatches ? (
          <p className="px-2 py-1 text-xs text-(--color-muted-foreground)">
            {normalizedSearchQuery ? "No chats match your search." : "No chats yet."}
          </p>
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
