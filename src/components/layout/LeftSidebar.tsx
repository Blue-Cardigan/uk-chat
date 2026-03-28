import { Plus, Trash2 } from "lucide-react";
import { Button, Card, Input } from "@/components/ui/primitives";
import type { ChatConversation } from "@/lib/types";

export function LeftSidebar({
  conversations,
  activeConversationId,
  onCreate,
  onSelect,
  onDelete,
  onRename,
}: {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  return (
    <aside className="flex h-full w-full flex-col gap-3 border-r border-[var(--color-border)] bg-[var(--color-sidebar)] p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Chats</h2>
        <Button variant="ghost" onClick={onCreate} aria-label="New chat">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {conversations.map((conversation) => {
          const isActive = conversation.id === activeConversationId;
          return (
            <Card key={conversation.id} className={isActive ? "border-[var(--color-primary)]" : ""}>
              <button type="button" className="mb-2 w-full text-left text-sm font-medium" onClick={() => onSelect(conversation.id)}>
                {conversation.title}
              </button>
              <div className="flex items-center gap-2">
                <Input
                  defaultValue={conversation.title}
                  className="h-8 text-xs"
                  onBlur={(event) => onRename(conversation.id, event.target.value)}
                />
                <Button variant="ghost" onClick={() => onDelete(conversation.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </aside>
  );
}
