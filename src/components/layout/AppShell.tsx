import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronLeft, PanelLeftOpen, X } from "lucide-react";
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
  onStarConversation,
  onShareConversation,
  onUnshareConversation,
  onConversationMissing,
  settingsContent,
  onClearActiveConversation,
}: {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  mcpToken: string | null;
  authToken: string | null;
  onCreateConversation: () => Promise<string | null>;
  onSelectConversation: (id: string | null) => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onStarConversation: (id: string, starred: boolean) => void;
  onShareConversation: (id: string, enabled?: boolean) => Promise<string | null>;
  onUnshareConversation: (id: string) => Promise<void>;
  onConversationMissing: (id: string) => Promise<void> | void;
  settingsContent: React.ReactNode;
  onClearActiveConversation: () => void;
}) {
  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const rightSidebarOpen = useAppStore((state) => state.rightSidebarOpen);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const setRightSidebarOpen = useAppStore((state) => state.setRightSidebarOpen);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareModalConversation, setShareModalConversation] = useState<ChatConversation | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [sharePending, setSharePending] = useState(false);
  const settingsDialogRef = useRef<HTMLDivElement | null>(null);
  const shareDialogRef = useRef<HTMLDivElement | null>(null);
  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  function buildShareUrl(shareToken: string) {
    if (typeof window === "undefined") return `/shared/${shareToken}`;
    return `${window.location.origin}/shared/${shareToken}`;
  }

  async function copyShareUrl(url: string) {
    if (typeof window === "undefined") return;
    try {
      await window.navigator.clipboard.writeText(url);
      setShareNotice("Share link copied to clipboard.");
    } catch {
      setShareNotice(`Share link: ${url}`);
    }
    window.setTimeout(() => setShareNotice(null), 3000);
  }

  function handleShareFromMenu(conversation: ChatConversation) {
    if (conversation.is_public && conversation.share_token) {
      void copyShareUrl(buildShareUrl(conversation.share_token));
      return;
    }
    setShareModalConversation(conversation);
  }

  function handleUnshareFromMenu(conversation: ChatConversation) {
    void onUnshareConversation(conversation.id);
    setShareNotice("Sharing disabled for this conversation.");
    window.setTimeout(() => setShareNotice(null), 3000);
  }

  useEffect(() => {
    if (!settingsOpen) return;
    const previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = settingsDialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    focusables?.[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSettingsOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      if (!focusables || focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocusedElement?.focus();
    };
  }, [FOCUSABLE_SELECTOR, settingsOpen]);

  useEffect(() => {
    if (!shareModalConversation) return;
    const previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = shareDialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    focusables?.[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShareModalConversation(null);
        return;
      }
      if (e.key !== "Tab") return;
      if (!focusables || focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocusedElement?.focus();
    };
  }, [FOCUSABLE_SELECTOR, shareModalConversation]);

  const desktopGridClass = sidebarOpen
    ? rightSidebarOpen
      ? "md:grid-cols-[280px_minmax(0,1fr)_320px]"
      : "md:grid-cols-[280px_minmax(0,1fr)_0px]"
    : rightSidebarOpen
      ? "md:grid-cols-[0px_minmax(0,1fr)_320px]"
      : "md:grid-cols-[0px_minmax(0,1fr)_0px]";

  return (
    <div className="h-dvh overflow-hidden bg-(--color-background) text-(--color-foreground)">
      <div
        className={cn(
          "relative grid h-full min-h-0 grid-cols-1 overflow-hidden md:transition-[grid-template-columns] md:duration-300 md:ease-out",
          desktopGridClass,
        )}
      >
        <div className={cn("min-h-0", sidebarOpen ? "fixed inset-0 z-40 md:relative md:inset-auto md:z-auto md:block" : "hidden md:block")}>
          {sidebarOpen ? (
            <button
              type="button"
              aria-label="Close navigation sidebar"
              className="absolute inset-0 bg-[color-mix(in_oklch,var(--color-foreground)_45%,transparent)] md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          ) : null}
          <div
            className={cn(
              "absolute left-0 top-0 h-full w-[280px] max-w-[88vw] md:relative md:min-h-0 md:h-full md:w-full md:max-w-none md:transition-[opacity,transform] md:duration-250 md:ease-out",
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
              onToggleStar={onStarConversation}
              onShare={handleShareFromMenu}
              onUnshare={handleUnshareFromMenu}
              onClearChat={onClearActiveConversation}
              onCollapse={() => setSidebarOpen(false)}
              onToggleSettings={() => setSettingsOpen((v) => !v)}
            />
          </div>
        </div>

        <main className="relative min-h-0">
          {!sidebarOpen ? (
            <Button
              variant="ghost"
              aria-label="Open navigation sidebar"
              className="absolute left-3 top-3 z-30 h-8 w-8 p-0"
              onClick={() => setSidebarOpen(true)}
            >
              <ChevronLeft className="h-4 w-4 md:hidden" />
              <PanelLeftOpen className="hidden h-4 w-4 md:block" />
            </Button>
          ) : null}
          {!rightSidebarOpen ? (
            <Button
              variant="ghost"
              aria-label="Show artifacts"
              className="absolute right-3 top-3 z-30 h-8 w-8 p-0"
              onClick={() => setRightSidebarOpen(true)}
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
          ) : null}
          <ChatView
            conversation={activeConversation}
            conversationId={activeConversationId}
            mcpToken={mcpToken}
            authToken={authToken}
            onEnsureConversation={onCreateConversation}
            onRenameConversation={onRenameConversation}
            onConversationMissing={onConversationMissing}
            onDeleteConversation={onDeleteConversation}
            onToggleStarConversation={onStarConversation}
            onShareConversation={handleShareFromMenu}
            onUnshareConversation={handleUnshareFromMenu}
          />
        </main>

        <div className={cn(rightSidebarOpen ? "fixed inset-0 z-40 md:relative md:inset-auto md:z-auto md:block" : "hidden md:block")}>
          {rightSidebarOpen ? (
            <button
              type="button"
              aria-label="Close insights sidebar"
              className="absolute inset-0 bg-[color-mix(in_oklch,var(--color-foreground)_45%,transparent)] md:hidden"
              onClick={() => setRightSidebarOpen(false)}
            />
          ) : null}
          <div
            className={cn(
              "absolute right-0 top-0 h-full w-full md:relative md:h-full md:w-full md:max-w-none md:transition-[opacity,transform] md:duration-250 md:ease-out",
              "md:w-[320px]",
              rightSidebarOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-0",
              rightSidebarOpen ? "md:translate-x-0 md:opacity-100" : "md:pointer-events-none md:translate-x-3 md:opacity-0",
            )}
          >
            <RightSidebar authToken={authToken} />
          </div>
        </div>
        {settingsOpen ? (
          <div
            className={cn(
              "absolute inset-y-0 right-0 z-50 overflow-y-auto bg-(--color-background)/95 backdrop-blur-sm",
              sidebarOpen ? "left-0 md:left-[280px]" : "left-0",
            )}
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            ref={settingsDialogRef}
          >
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
        {shareModalConversation ? (
          <div
            className={cn(
              "absolute inset-y-0 right-0 z-60 flex items-center justify-center bg-[color-mix(in_oklch,var(--color-foreground)_40%,transparent)] px-4",
              sidebarOpen ? "left-0 md:left-[280px]" : "left-0",
            )}
            role="dialog"
            aria-modal="true"
            aria-label="Share conversation"
            ref={shareDialogRef}
          >
            <div className="w-full max-w-md rounded-lg border border-(--color-border) bg-(--color-card) p-4 shadow-xl">
              <h3 className="text-sm font-semibold">Share conversation publicly?</h3>
              <p className="mt-2 text-sm text-(--color-muted-foreground)">
                Anyone with the link will be able to view this conversation and its artifacts. The shared link expires automatically and can be revoked from the chat menu.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setShareModalConversation(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={sharePending}
                  onClick={async () => {
                    if (!shareModalConversation) return;
                    setSharePending(true);
                    const shareUrl = await onShareConversation(shareModalConversation.id);
                    const token = shareModalConversation.share_token;
                    const fallbackUrl = token ? buildShareUrl(token) : null;
                    const url = shareUrl ?? fallbackUrl;
                    if (url) await copyShareUrl(url);
                    setSharePending(false);
                    setShareModalConversation(null);
                  }}
                >
                  {sharePending ? "Sharing..." : "Share conversation"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {shareNotice ? (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute bottom-4 right-4 z-70 rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-xs shadow-md"
          >
            {shareNotice}
          </div>
        ) : null}
      </div>
    </div>
  );
}
