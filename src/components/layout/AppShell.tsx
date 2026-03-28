import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { ChatView } from "@/components/chat/ChatView";
import { useAppStore } from "@/lib/store";
import type { ChatConversation } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AppShell({
  conversations,
  activeConversationId,
  mcpToken,
  authToken,
  onCreateConversation,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  onConversationMissing,
  settingsContent,
}: {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  mcpToken: string | null;
  authToken: string | null;
  onCreateConversation: () => Promise<string | null>;
  onSelectConversation: (id: string | null) => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onConversationMissing: (id: string) => Promise<void> | void;
  settingsContent: React.ReactNode;
}) {
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const rightSidebarOpen = useAppStore((state) => state.rightSidebarOpen);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const setRightSidebarOpen = useAppStore((state) => state.setRightSidebarOpen);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!settingsOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSettingsOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen]);

  const desktopGridClass = sidebarOpen
    ? rightSidebarOpen
      ? "md:grid-cols-[280px_minmax(0,1fr)_minmax(0,1fr)]"
      : "md:grid-cols-[280px_minmax(0,1fr)_0px]"
    : rightSidebarOpen
      ? "md:grid-cols-[0px_minmax(0,1fr)_minmax(0,1fr)]"
      : "md:grid-cols-[0px_minmax(0,1fr)_0px]";

  return (
    <div className="flex h-screen flex-col bg-(--color-background) text-(--color-foreground)">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-(--color-border) px-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="group transition-transform duration-200 ease-out hover:scale-105 active:scale-95" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? (
              <PanelLeftClose className="h-4 w-4 transition-transform duration-200 ease-out group-hover:-rotate-6" />
            ) : (
              <PanelLeftOpen className="h-4 w-4 transition-transform duration-200 ease-out group-hover:rotate-6" />
            )}
          </Button>
          <h1 className="font-display text-lg">
            <span className="hidden sm:inline">Explore the Kingdom </span>
            <span className="sm:hidden">ETK </span>
            Chat
          </h1>
        </div>
      </header>

      <div className={cn("grid min-h-0 flex-1 grid-cols-1 md:transition-[grid-template-columns] md:duration-300 md:ease-out", desktopGridClass)}>
        <div className={cn(sidebarOpen ? "fixed inset-0 z-40 md:relative md:inset-auto md:z-auto md:block" : "hidden md:block")}>
          {sidebarOpen ? (
            <button
              type="button"
              aria-label="Close navigation sidebar"
              className="absolute inset-0 bg-black/45 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          ) : null}
          <div
            className={cn(
              "absolute left-0 top-0 h-full w-[280px] max-w-[88vw] md:relative md:h-full md:w-full md:max-w-none md:transition-[opacity,transform] md:duration-250 md:ease-out",
              sidebarOpen ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0",
              sidebarOpen ? "md:translate-x-0 md:opacity-100" : "md:pointer-events-none md:-translate-x-3 md:opacity-0",
            )}
          >
            <LeftSidebar
              conversations={conversations}
              activeConversationId={activeConversationId}
              onCreate={onCreateConversation}
              onSelect={onSelectConversation}
              onDelete={onDeleteConversation}
              onRename={onRenameConversation}
              onToggleSettings={() => setSettingsOpen((v) => !v)}
            />
          </div>
        </div>

        <main className={cn("relative min-h-0", rightSidebarOpen ? "w-full" : "mx-auto w-full max-w-4xl")}>
          <ChatView
            conversationId={activeConversationId}
            mcpToken={mcpToken}
            authToken={authToken}
            onEnsureConversation={onCreateConversation}
            onConversationMissing={onConversationMissing}
          />
        </main>

        <div className={cn(rightSidebarOpen ? "fixed inset-0 z-40 md:relative md:inset-auto md:z-auto md:block" : "hidden md:block")}>
          {rightSidebarOpen ? (
            <button
              type="button"
              aria-label="Close insights sidebar"
              className="absolute inset-0 bg-black/45 md:hidden"
              onClick={() => setRightSidebarOpen(false)}
            />
          ) : null}
          <div
            className={cn(
              "absolute right-0 top-0 h-full w-[320px] max-w-[92vw] md:relative md:h-full md:w-full md:max-w-none md:transition-[opacity,transform] md:duration-250 md:ease-out",
              rightSidebarOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-0",
              rightSidebarOpen ? "md:translate-x-0 md:opacity-100" : "md:pointer-events-none md:translate-x-3 md:opacity-0",
            )}
          >
            <RightSidebar />
          </div>
        </div>
      </div>
      {settingsOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-(--color-background)/95 backdrop-blur-sm">
          <div className="flex justify-end p-3">
            <Button
              type="button"
              variant="ghost"
              aria-label="Close settings"
              className="h-8 w-8 p-0 opacity-70 hover:opacity-100"
              onClick={() => setSettingsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mx-auto w-full max-w-md px-4 pb-8">
            {settingsContent}
          </div>
        </div>
      ) : null}
    </div>
  );
}
