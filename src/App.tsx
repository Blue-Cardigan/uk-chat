import { useEffect, useMemo, useState } from "react";
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

function ProtectedApp() {
  const { session } = useAuth();
  const setConversations = useAppStore((state) => state.setConversations);
  const conversations = useAppStore((state) => state.conversations);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const setActiveConversationId = useAppStore((state) => state.setActiveConversationId);
  const theme = useAppStore((state) => state.themePreference);
  const setTheme = useAppStore((state) => state.setThemePreference);
  const [mcpToken, setMcpToken] = useState<string | null>(null);
  const isAdmin = (session?.user.email ?? "").toLowerCase() === (import.meta.env.VITE_ADMIN_EMAIL ?? "").toLowerCase();

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
    fetch("/api/conversations", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((response) => response.json())
      .then((data: ChatConversation[]) => {
        setConversations(data);
        if (!activeConversationId && data.length > 0) setActiveConversationId(data[0].id);
      })
      .catch(() => setConversations([]));

    supabase
      .from("uk_chat_profiles")
      .select("mcp_token")
      .eq("id", session.user.id)
      .single()
      .then(async ({ data }) => {
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
          .single();
        const pendingToken = gate?.pending_mcp_token as string | null | undefined;
        if (!pendingToken) return;
        setMcpToken(pendingToken);
        await supabase.from("uk_chat_profiles").update({ mcp_token: pendingToken }).eq("id", session.user.id);
        await supabase
          .from("uk_chat_email_gate")
          .update({ claimed_at: new Date().toISOString() })
          .eq("email", email);
      });
  }, [activeConversationId, session?.user.id, setActiveConversationId, setConversations]);

  const titleForNewConversation = useMemo(() => `New chat ${conversations.length + 1}`, [conversations.length]);

  async function createConversation() {
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ title: titleForNewConversation }),
    });
    const created = (await response.json()) as ChatConversation;
    setConversations([created, ...conversations]);
    setActiveConversationId(created.id);
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

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px]">
      <AppShell
        conversations={conversations}
        activeConversationId={activeConversationId}
        mcpToken={mcpToken}
        authToken={session?.access_token ?? null}
        onCreateConversation={createConversation}
        onSelectConversation={setActiveConversationId}
        onDeleteConversation={deleteConversation}
        onRenameConversation={renameConversation}
      />
      <aside className="hidden border-l border-[var(--color-border)] bg-[var(--color-sidebar)] p-3 xl:block">
        <div className="flex h-full flex-col gap-3 overflow-y-auto">
          <SettingsPanel theme={theme} onThemeChange={setTheme} mcpToken={mcpToken} />
          {isAdmin ? <AdminPanel /> : null}
        </div>
      </aside>
    </div>
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
