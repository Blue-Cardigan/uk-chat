import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { ChatView } from "@/components/chat/ChatView";
import { useAppStore } from "@/lib/store";
import type { ChatConversation } from "@/lib/types";

export function AppShell({
  conversations,
  activeConversationId,
  mcpToken,
  authToken,
  onCreateConversation,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
}: {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  mcpToken: string | null;
  authToken: string | null;
  onCreateConversation: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
}) {
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const rightSidebarOpen = useAppStore((state) => state.rightSidebarOpen);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const setRightSidebarOpen = useAppStore((state) => state.setRightSidebarOpen);

  return (
    <div className="flex h-screen flex-col bg-(--color-background) text-(--color-foreground)">
      <header className="flex h-14 items-center justify-between border-b border-(--color-border) px-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </Button>
          <h1 className="font-display text-lg">Explore the Kingdom Chat</h1>
        </div>
        <Button variant="ghost" onClick={() => setRightSidebarOpen(!rightSidebarOpen)}>
          {rightSidebarOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[280px_1fr_420px]">
        <div className={sidebarOpen ? "block" : "hidden md:hidden"}>
          <LeftSidebar
            conversations={conversations}
            activeConversationId={activeConversationId}
            onCreate={onCreateConversation}
            onSelect={onSelectConversation}
            onDelete={onDeleteConversation}
            onRename={onRenameConversation}
          />
        </div>
        <main className="min-h-0 p-3">
          <Card className="h-full">
            <ChatView conversationId={activeConversationId} mcpToken={mcpToken} authToken={authToken} />
          </Card>
        </main>
        <div className={rightSidebarOpen ? "block" : "hidden md:hidden"}>
          <RightSidebar />
        </div>
      </div>
    </div>
  );
}
