import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { LoginPage } from "@/components/auth/LoginPage";
import { AuthCallbackPage } from "@/components/auth/AuthCallbackPage";
import { Card } from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth";
import { useAppStore } from "@/lib/store";
import { safeJson } from "@/lib/http";
import type { ChatConversation } from "@/lib/types";

const PrivacyNoticePage = lazy(() => import("@/components/legal/PrivacyNoticePage").then((m) => ({ default: m.PrivacyNoticePage })));
const SharedChatView = lazy(() => import("@/components/chat/SharedChatView").then((m) => ({ default: m.SharedChatView })));
const AdminPanel = lazy(() => import("@/components/auth/AdminPanel").then((m) => ({ default: m.AdminPanel })));
const SettingsPanel = lazy(() => import("@/components/settings/SettingsPanel").then((m) => ({ default: m.SettingsPanel })));

function getConversationIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("chat");
}

function syncConversationIdToUrl(conversationId: string | null) {
  const url = new URL(window.location.href);
  if (conversationId) {
    url.searchParams.set("chat", conversationId);
  } else {
    url.searchParams.delete("chat");
  }
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;
  window.history.replaceState(null, "", nextUrl);
}

function ProtectedApp() {
  const { session, signOut } = useAuth();
  const setConversations = useAppStore((state) => state.setConversations);
  const conversations = useAppStore((state) => state.conversations);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const setActiveConversationId = useAppStore((state) => state.setActiveConversationId);
  const theme = useAppStore((state) => state.themePreference);
  const setTheme = useAppStore((state) => state.setThemePreference);
  const [mcpToken, setMcpToken] = useState<string | null>(null);
  const [mcpTokenUnauthorized, setMcpTokenUnauthorized] = useState(false);
  const isAdmin = (session?.user.email ?? "").toLowerCase() === (import.meta.env.VITE_ADMIN_EMAIL ?? "").toLowerCase();

  const loadConversations = useCallback(async (signal?: AbortSignal) => {
    if (!session?.access_token) {
      setConversations([]);
      setActiveConversationId(null);
      syncConversationIdToUrl(null);
      return [] as ChatConversation[];
    }

    const response = await fetch("/api/conversations", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal,
    });
    if (!response.ok) throw new Error(`Failed to load conversations (${response.status})`);

    const raw = (await safeJson<ChatConversation[]>(response)) ?? [];
    const data = raw.map((conversation) => ({
      ...conversation,
      starred: conversation.starred ?? false,
      is_public: conversation.is_public ?? false,
      share_token: conversation.share_token ?? null,
      share_expires_at: conversation.share_expires_at ?? null,
    }));
    setConversations(data);

    const current = useAppStore.getState().activeConversationId;
    const preferredConversationId = getConversationIdFromUrl();
    const hasUrlConversation = preferredConversationId && data.some((conversation) => conversation.id === preferredConversationId);
    const hasCurrentConversation = current && data.some((conversation) => conversation.id === current);
    const nextActiveId = hasUrlConversation ? preferredConversationId : hasCurrentConversation ? current : data[0]?.id ?? null;
    setActiveConversationId(nextActiveId);
    syncConversationIdToUrl(nextActiveId);

    return data;
  }, [session?.access_token, setActiveConversationId, setConversations]);

  const refreshMcpToken = useCallback(
    async (signal?: AbortSignal) => {
      if (!session?.access_token) {
        setMcpToken(null);
        setMcpTokenUnauthorized(false);
        return null;
      }
      try {
        const response = await fetch("/api/account/profile", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          signal,
        });
        if (signal?.aborted) return null;
        if (!response.ok) {
          setMcpToken(null);
          return null;
        }
        const payload = (await safeJson<{ mcpToken?: string | null }>(response)) ?? {};
        if (signal?.aborted) return null;
        const nextToken = payload.mcpToken ?? null;
        setMcpToken(nextToken);
        if (nextToken) setMcpTokenUnauthorized(false);
        return nextToken;
      } catch {
        if (signal?.aborted) return null;
        setMcpToken(null);
        return null;
      }
    },
    [session?.access_token],
  );

  useEffect(() => {
    const root = document.documentElement;
    const resolved = theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
    root.dataset.theme = resolved;

    // Keep browser chrome color in sync with the resolved theme.
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      const backgroundColor = getComputedStyle(document.body).backgroundColor;
      if (backgroundColor) {
        themeColorMeta.setAttribute("content", backgroundColor);
      }
    }
  }, [theme]);

  useEffect(() => {
    if (!session?.access_token) return undefined;
    const controller = new AbortController();
    const { signal } = controller;

    void loadConversations(signal).catch(() => {
      if (signal.aborted) return;
      setConversations([]);
      setActiveConversationId(null);
      syncConversationIdToUrl(null);
    });
    void refreshMcpToken(signal);

    return () => {
      controller.abort();
    };
  }, [loadConversations, refreshMcpToken, session?.access_token, setActiveConversationId, setConversations]);

  const handleMcpTokenUnauthorized = useCallback(() => {
    setMcpToken(null);
    void (async () => {
      const refreshedToken = await refreshMcpToken();
      if (!refreshedToken) {
        setMcpTokenUnauthorized(true);
      }
    })();
  }, [refreshMcpToken]);

  const createConversation = useCallback(async () => {
    const currentConversations = useAppStore.getState().conversations;
    const titleForNewConversation = `New chat ${currentConversations.length + 1}`;

    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ title: titleForNewConversation }),
    });
    if (!response.ok) return null;
    const created = await safeJson<ChatConversation>(response);
    if (!created) return null;
    const normalizedCreated = {
      ...created,
      starred: created.starred ?? false,
      is_public: created.is_public ?? false,
      share_token: created.share_token ?? null,
      share_expires_at: created.share_expires_at ?? null,
    };
    const conversationsAfterCreate = useAppStore.getState().conversations;
    setConversations([normalizedCreated, ...conversationsAfterCreate.filter((conversation) => conversation.id !== normalizedCreated.id)]);
    setActiveConversationId(normalizedCreated.id);
    syncConversationIdToUrl(normalizedCreated.id);
    return normalizedCreated.id;
  }, [session?.access_token, setActiveConversationId, setConversations]);

  const startNewConversation = useCallback(() => {
    setActiveConversationId(null);
    syncConversationIdToUrl(null);
  }, [setActiveConversationId]);

  const deleteConversation = useCallback(async (id: string) => {
    const response = await fetch(`/api/conversations/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    });
    if (!response.ok) return;

    const next = useAppStore.getState().conversations.filter((conversation) => conversation.id !== id);
    setConversations(next);
    if (useAppStore.getState().activeConversationId === id) {
      const nextActiveConversationId = next[0]?.id ?? null;
      setActiveConversationId(nextActiveConversationId);
      syncConversationIdToUrl(nextActiveConversationId);
    }
  }, [session?.access_token, setActiveConversationId, setConversations]);

  const renameConversation = useCallback(async (id: string, title: string) => {
    const response = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) return;

    const currentConversations = useAppStore.getState().conversations;
    setConversations(currentConversations.map((conversation) => (conversation.id === id ? { ...conversation, title } : conversation)));
  }, [session?.access_token, setConversations]);

  const starConversation = useCallback(async (id: string, starred: boolean) => {
    const response = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ starred }),
    });
    if (!response.ok) return;

    const currentConversations = useAppStore.getState().conversations;
    const next = currentConversations.map((conversation) => (conversation.id === id ? { ...conversation, starred } : conversation));
    next.sort((a, b) => {
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    setConversations(next);
  }, [session?.access_token, setConversations]);

  const shareConversation = useCallback(async (id: string, enabled = true) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${session?.access_token ?? ""}` };
    const body = enabled ? undefined : JSON.stringify({ enabled: false });
    if (!enabled) headers["Content-Type"] = "application/json";
    const response = await fetch(`/api/conversations/${id}/share`, {
      method: enabled ? "POST" : "PATCH",
      headers,
      body,
    });
    if (!response.ok) return null;
    const payload = await safeJson<{ conversation?: ChatConversation; shareUrl?: string }>(response);
    const sharedConversation = payload?.conversation;
    const shareUrl = payload?.shareUrl ?? null;
    if (!sharedConversation) return shareUrl;

    const currentConversations = useAppStore.getState().conversations;
    setConversations(
      currentConversations.map((conversation) =>
        conversation.id === id
          ? {
              ...conversation,
              is_public: sharedConversation.is_public ?? false,
              share_token: sharedConversation.share_token ?? null,
              share_expires_at: sharedConversation.share_expires_at ?? null,
            }
          : conversation,
      ),
    );
    return shareUrl;
  }, [session?.access_token, setConversations]);

  const unshareConversation = useCallback(
    async (id: string) => {
      await shareConversation(id, false);
    },
    [shareConversation],
  );

  async function exportChats() {
    if (!session?.access_token) throw new Error("Missing auth token");
    const response = await fetch("/api/account/export", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!response.ok) throw new Error(`Export failed (${response.status})`);
    const exportPayload = await response.json();

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const link = document.createElement("a");
    link.href = url;
    link.download = `uk-chat-export-${timestamp}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function deleteAccount() {
    if (!session?.access_token) throw new Error("Missing auth token");
    const response = await fetch("/api/account", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!response.ok) throw new Error("Account deletion failed");
    await signOut();
  }

  const handleConversationMissing = useCallback(
    async (missingId: string) => {
      const knownConversation = useAppStore.getState().conversations.some((conversation) => conversation.id === missingId);
      if (!knownConversation) return;

      const nextConversations = useAppStore.getState().conversations.filter((conversation) => conversation.id !== missingId);
      setConversations(nextConversations);
      if (useAppStore.getState().activeConversationId === missingId) {
        const nextActiveConversationId = nextConversations[0]?.id ?? null;
        setActiveConversationId(nextActiveConversationId);
        syncConversationIdToUrl(nextActiveConversationId);
      }

      try {
        const refreshed = await loadConversations();
        if (refreshed.some((conversation) => conversation.id === missingId)) return;
      } catch {
        // If reloading the canonical list fails, keep the current sidebar state intact.
      }
    },
    [loadConversations, setActiveConversationId, setConversations],
  );

  const handleSelectConversation = useCallback(
    (id: string | null) => {
      setActiveConversationId(id);
      syncConversationIdToUrl(id);
    },
    [setActiveConversationId],
  );

  const handleClearActiveConversation = useCallback(() => {
    setActiveConversationId(null);
    syncConversationIdToUrl(null);
  }, [setActiveConversationId]);

  const settingsPanelProps = {
    theme,
    onThemeChange: setTheme,
    authToken: session?.access_token ?? null,
    mcpToken,
    onExportChats: exportChats,
    onDeleteAccount: deleteAccount,
    onSignOut: signOut,
  } as const;

  const settingsContent = (
    <div className="space-y-4">
      <Suspense fallback={<div className="p-4 text-sm text-(--color-muted-foreground)">Loading settings...</div>}>
        <SettingsPanel {...settingsPanelProps} />
        {isAdmin ? <AdminPanel /> : null}
      </Suspense>
    </div>
  );

  return (
    <AppShell
      conversations={conversations}
      activeConversationId={activeConversationId}
      mcpToken={mcpToken}
      mcpTokenUnauthorized={mcpTokenUnauthorized}
      authToken={session?.access_token ?? null}
      onStartNewConversation={startNewConversation}
      onEnsureConversation={createConversation}
      onSelectConversation={handleSelectConversation}
      onDeleteConversation={deleteConversation}
      onRenameConversation={renameConversation}
      onStarConversation={starConversation}
      onShareConversation={shareConversation}
      onUnshareConversation={unshareConversation}
      onConversationMissing={handleConversationMissing}
      onMcpTokenUnauthorized={handleMcpTokenUnauthorized}
      settingsContent={settingsContent}
      onClearActiveConversation={handleClearActiveConversation}
    />
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <Card className="m-8">Loading...</Card>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<Card className="m-8">Loading...</Card>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/privacy" element={<PrivacyNoticePage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/shared/:token" element={<SharedChatView />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <ProtectedApp />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
