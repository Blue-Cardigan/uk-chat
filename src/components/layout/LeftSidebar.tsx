import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Plus, Settings } from "lucide-react";
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
  onToggleSettings,
}: {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  onCreate: () => Promise<string | null>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onToggleSettings: () => void;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const conversationById = useMemo(() => new Map(conversations.map((conversation) => [conversation.id, conversation])), [conversations]);

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

  return (
    <aside className="flex h-full w-full flex-col gap-3 border-r border-(--color-border) bg-(--color-sidebar) p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Chats</h2>
        <Button variant="ghost" onClick={onCreate} aria-label="New chat">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {conversations.map((conversation) => {
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
                  isActive
                    ? "bg-[color-mix(in_oklch,var(--color-primary)_14%,var(--color-sidebar)_86%)]"
                    : "hover:bg-[color-mix(in_oklch,var(--color-foreground)_6%,transparent)]",
                )}
              >
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

                <Button
                  variant="ghost"
                  className={cn(
                    "h-11 w-11 p-0 sm:h-7 sm:w-7 transition-opacity",
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
                  <div ref={menuRef} className="absolute right-0 top-10 z-10 min-w-36 rounded-md border border-(--color-border) bg-(--color-card) p-1 shadow-sm">
                    <button
                      type="button"
                      className="w-full rounded px-2 py-1 text-left text-xs font-medium hover:bg-[color-mix(in_oklch,var(--color-foreground)_6%,transparent)]"
                      onClick={() => startRename(conversation.id)}
                    >
                      Edit name
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

              {isEditing ? (
                <form
                  className="mt-1 flex items-center gap-2 px-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitRename(conversation.id);
                  }}
                >
                  <Input
                    value={draftTitle}
                    className="h-8 text-xs"
                    onChange={(event) => setDraftTitle(event.target.value)}
                    autoFocus
                  />
                  <Button type="submit" variant="secondary" className="h-8 px-2 text-xs">
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 px-2 text-xs"
                    onClick={() => {
                      setEditingId(null);
                    }}
                  >
                    Cancel
                  </Button>
                </form>
              ) : null}
            </div>
          );
        })}
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
