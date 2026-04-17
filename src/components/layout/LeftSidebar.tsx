import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MoreHorizontal, PanelLeftClose, Plus, Search, Settings, Star } from "lucide-react";
import { ConversationContextMenu } from "@/components/chat/ConversationContextMenu";
import { Button, Input } from "@/components/ui/primitives";
import type { ChatConversation } from "@/lib/types";
import { cn } from "@/lib/utils";

type SidebarRow =
  | { kind: "header"; label: string; key: string }
  | { kind: "conversation"; conversation: ChatConversation; key: string };

export function LeftSidebar({
  conversations,
  activeConversationId,
  onCreate,
  onSelect,
  onDelete,
  onRename,
  onToggleStar,
  onShare,
  onUnshare,
  onCollapse,
  onToggleSettings,
  onClearChat,
}: {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onToggleStar: (id: string, starred: boolean) => void;
  onShare: (conversation: ChatConversation) => void;
  onUnshare: (conversation: ChatConversation) => void;
  onCollapse: () => void;
  onToggleSettings: () => void;
  onClearChat: () => void;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
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
  const hasChatMatches = filteredStarredConversations.length + filteredRecentConversations.length > 0;

  const rows = useMemo<SidebarRow[]>(() => {
    const out: SidebarRow[] = [];
    if (filteredStarredConversations.length > 0) {
      out.push({ kind: "header", label: "Starred", key: "header:starred" });
      for (const conversation of filteredStarredConversations) {
        out.push({ kind: "conversation", conversation, key: `s:${conversation.id}` });
      }
    }
    if (filteredRecentConversations.length > 0) {
      if (filteredStarredConversations.length > 0) {
        out.push({ kind: "header", label: "Recent", key: "header:recent" });
      }
      for (const conversation of filteredRecentConversations) {
        out.push({ kind: "conversation", conversation, key: `r:${conversation.id}` });
      }
    }
    return out;
  }, [filteredStarredConversations, filteredRecentConversations]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => (rows[index]?.kind === "header" ? 28 : 44),
    overscan: 8,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  useEffect(() => {
    if (!openMenuId && !editingId) return;

    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      setOpenMenuId(null);
      setMenuAnchor(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenMenuId(null);
      setMenuAnchor(null);
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
    if (!openMenuId) return;

    function handleClose() {
      setOpenMenuId(null);
      setMenuAnchor(null);
    }

    const listElement = listRef.current;
    listElement?.addEventListener("scroll", handleClose, { passive: true });
    window.addEventListener("resize", handleClose);
    return () => {
      listElement?.removeEventListener("scroll", handleClose);
      window.removeEventListener("resize", handleClose);
    };
  }, [openMenuId]);

  function startRename(id: string) {
    const conversation = conversationById.get(id);
    if (!conversation) return;
    setDraftTitle(conversation.title);
    setEditingId(id);
    setOpenMenuId(null);
    setMenuAnchor(null);
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
        role="listitem"
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
                aria-label="Rename chat"
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
              conversation.starred ? "opacity-100 text-(--color-warning)" : "opacity-0 group-hover:opacity-100 focus:opacity-100",
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
              const nextMenuId = openMenuId === conversation.id ? null : conversation.id;
              if (nextMenuId) {
                const triggerRect = event.currentTarget.getBoundingClientRect();
                const estimatedMenuHeight = 180;
                const estimatedMenuWidth = 176;
                const spaceBelow = window.innerHeight - triggerRect.bottom;
                const shouldOpenDown = spaceBelow >= estimatedMenuHeight || spaceBelow >= triggerRect.top;
                const top = shouldOpenDown
                  ? triggerRect.bottom + 4
                  : Math.max(8, triggerRect.top - estimatedMenuHeight - 4);
                const left = Math.max(
                  8,
                  Math.min(triggerRect.right - estimatedMenuWidth, window.innerWidth - estimatedMenuWidth - 8),
                );
                setMenuAnchor({ top, left });
              } else {
                setMenuAnchor(null);
              }
              setOpenMenuId(nextMenuId);
            }}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>

          {isMenuOpen && menuAnchor
            ? createPortal(
                <ConversationContextMenu
                  conversation={conversation}
                  containerRef={menuRef}
                  className="z-120 min-w-44 rounded-md border border-(--color-border) bg-(--color-background) p-1 shadow-xl"
                  style={{ position: "fixed", top: menuAnchor.top, left: menuAnchor.left }}
                  onRename={() => startRename(conversation.id)}
                  onToggleStar={() => {
                    onToggleStar(conversation.id, !conversation.starred);
                    setOpenMenuId(null);
                    setMenuAnchor(null);
                  }}
                  onShare={() => {
                    onShare(conversation);
                    setOpenMenuId(null);
                    setMenuAnchor(null);
                  }}
                  onUnshare={() => {
                    onUnshare(conversation);
                    setOpenMenuId(null);
                    setMenuAnchor(null);
                  }}
                  onDelete={() => onDelete(conversation.id)}
                />,
                document.body,
              )
            : null}
        </div>
      </div>
    );
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col gap-3 border-r border-(--color-border) bg-(--color-sidebar) p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="font-display text-xl font-semibold"
            onClick={onClearChat}
            aria-label="Clear current chat"
          >
            Chat
            <span className="text-(--color-accent)">G</span>
            <span className="text-(--color-primary)">B</span>
          </button>
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
      <nav aria-label="Conversations" ref={listRef} className="relative isolate flex min-h-0 flex-1 flex-col overflow-y-auto">
        {hasChatMatches ? (
          <div role="list" style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
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
                  }}
                >
                  {row.kind === "header" ? (
                    <p
                      className={cn(
                        "px-2 text-[11px] font-semibold uppercase tracking-wide text-(--color-muted-foreground)",
                        row.key === "header:recent" ? "pt-2" : "",
                      )}
                    >
                      {row.label}
                    </p>
                  ) : (
                    renderConversation(row.conversation)
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-2 py-1 text-xs text-(--color-muted-foreground)">
            {normalizedSearchQuery ? "No chats match your search." : "No chats yet."}
          </p>
        )}
      </nav>

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
