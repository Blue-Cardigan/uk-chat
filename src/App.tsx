import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { LoginPage } from "@/components/auth/LoginPage";
import { AuthCallbackPage } from "@/components/auth/AuthCallbackPage";
import { AdminPanel } from "@/components/auth/AdminPanel";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { Card } from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth";
import { useAppStore } from "@/lib/store";
import type { ChatConversation } from "@/lib/types";
import { supabase } from "@/lib/supabase";

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

    const data = (await safeJson<ChatConversation[]>(response)) ?? [];
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
  }, [theme]);

  useEffect(() => {
    if (!session?.user.id) return;
    void supabase
      .from("uk_chat_profiles")
      .upsert({ id: session.user.id, email: session.user.email?.toLowerCase() ?? null, display_name: session.user.email ?? null }, { onConflict: "id" });
    void loadConversations().catch(() => {
      setConversations([]);
      setActiveConversationId(null);
    });

    supabase
      .from("uk_chat_profiles")
      .select("mcp_token")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (error) return;
        if (data?.mcp_token) {
          setMcpToken(data.mcp_token);
          return;
        }
        const email = session.user.email?.toLowerCase();
        if (!email) return;
        const { data: gate } = await supabase
          .from("uk_chat_email_gate")
          .select("pending_mcp_token")
          .eq("email", email)
          .maybeSingle();
        const pendingToken = gate?.pending_mcp_token as string | null | undefined;
        if (!pendingToken) return;
        setMcpToken(pendingToken);
        await supabase.from("uk_chat_profiles").update({ mcp_token: pendingToken }).eq("id", session.user.id);
        await supabase
          .from("uk_chat_email_gate")
          .update({ claimed_at: new Date().toISOString() })
          .eq("email", email);
      });
  }, [loadConversations, session?.user.id, setActiveConversationId, setConversations]);

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
    setConversations([created, ...conversations]);
    setActiveConversationId(created.id);
    return created.id;
  }

  async function deleteConversation(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } });
    const next = conversations.filter((conversation) => conversation.id !== id);
    setConversations(next);
    if (activeConversationId === id) setActiveConversationId(next[0]?.id ?? null);
  }

  async function renameConversation(id: string, title: string) {
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ title }),
    });
    setConversations(conversations.map((conversation) => (conversation.id === id ? { ...conversation, title } : conversation)));
  }

  async function exportChats() {
    if (!session?.access_token) throw new Error("Missing auth token");
    const exportConversations = await Promise.all(
      conversations.map(async (conversation) => {
        const response = await fetch(`/api/conversations/${conversation.id}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!response.ok) {
          return { ...conversation, messages: [], export_error: `Failed to load messages (${response.status})` };
        }
        const payload = (await safeJson<{ messages?: unknown[] }>(response)) ?? { messages: [] };
        return { ...conversation, messages: payload.messages ?? [] };
      }),
    );

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      user: {
        id: session.user.id,
        email: session.user.email ?? null,
      },
      conversations: exportConversations,
    };

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

  const handleConversationMissing = useCallback(
    async (missingId: string) => {
      const knownConversation = useAppStore.getState().conversations.some((conversation) => conversation.id === missingId);
      if (!knownConversation) return;

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
    mcpToken,
    onExportChats: exportChats,
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
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
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
