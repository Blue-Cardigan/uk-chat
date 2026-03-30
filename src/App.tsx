import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { LoginPage } from "@/components/auth/LoginPage";
import { AuthCallbackPage } from "@/components/auth/AuthCallbackPage";
import { PrivacyNoticePage } from "@/components/legal/PrivacyNoticePage";
import { AdminPanel } from "@/components/auth/AdminPanel";
import { SharedChatView } from "@/components/chat/SharedChatView";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { Card } from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth";
import { useAppStore } from "@/lib/store";
import type { ChatConversation } from "@/lib/types";

async function safeJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
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
  const isAdmin = (session?.user.email ?? "").toLowerCase() === (import.meta.env.VITE_ADMIN_EMAIL ?? "").toLowerCase();

  const loadConversations = useCallback(async () => {
    if (!session?.access_token) {
      setConversations([]);
      setActiveConversationId(null);
      return [] as ChatConversation[];
    }

    const response = await fetch("/api/conversations", {
      headers: { Authorization: `Bearer ${session.access_token}` },
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
    const nextActiveId = current && data.some((conversation) => conversation.id === current) ? current : data[0]?.id ?? null;
    setActiveConversationId(nextActiveId);

    return data;
  }, [session?.access_token, setActiveConversationId, setConversations]);

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
    if (!session?.access_token) return;
    void loadConversations().catch(() => {
      setConversations([]);
      setActiveConversationId(null);
    });
    void (async () => {
      const response = await fetch("/api/account/profile", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) {
        setMcpToken(null);
        return;
      }
      const payload = (await safeJson<{ mcpToken?: string | null }>(response)) ?? {};
      setMcpToken(payload.mcpToken ?? null);
    })();
  }, [loadConversations, session?.access_token, setActiveConversationId, setConversations]);

  const titleForNewConversation = useMemo(() => `New chat ${conversations.length + 1}`, [conversations.length]);

  async function createConversation() {
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
    const currentConversations = useAppStore.getState().conversations;
    setConversations([normalizedCreated, ...currentConversations]);
    setActiveConversationId(normalizedCreated.id);
    return normalizedCreated.id;
  }

  async function deleteConversation(id: string) {
    const response = await fetch(`/api/conversations/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    });
    if (!response.ok) return;

    const next = useAppStore.getState().conversations.filter((conversation) => conversation.id !== id);
    setConversations(next);
    if (useAppStore.getState().activeConversationId === id) {
      setActiveConversationId(next[0]?.id ?? null);
    }
  }

  async function renameConversation(id: string, title: string) {
    const response = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) return;

    const currentConversations = useAppStore.getState().conversations;
    setConversations(currentConversations.map((conversation) => (conversation.id === id ? { ...conversation, title } : conversation)));
  }

  async function starConversation(id: string, starred: boolean) {
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
  }

  async function shareConversation(id: string, enabled = true) {
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
  }

  async function unshareConversation(id: string) {
    await shareConversation(id, false);
  }

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
        setActiveConversationId(nextConversations[0]?.id ?? null);
      }

      try {
        const refreshed = await loadConversations();
        if (refreshed.some((conversation) => conversation.id === missingId)) return;
      } catch {
        // If reloading the canonical list fails, keep the current sidebar state intact.
      }
    },
    [loadConversations],
  );

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
      <SettingsPanel {...settingsPanelProps} />
      {isAdmin ? <AdminPanel /> : null}
    </div>
  );

  return (
    <AppShell
      conversations={conversations}
      activeConversationId={activeConversationId}
      mcpToken={mcpToken}
      authToken={session?.access_token ?? null}
      onCreateConversation={createConversation}
      onSelectConversation={setActiveConversationId}
      onDeleteConversation={deleteConversation}
      onRenameConversation={renameConversation}
      onStarConversation={starConversation}
      onShareConversation={shareConversation}
      onUnshareConversation={unshareConversation}
      onConversationMissing={handleConversationMissing}
      settingsContent={settingsContent}
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
    </Routes>
  );
}
