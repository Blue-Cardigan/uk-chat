import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { UIMessage } from "ai";
import { useParams } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { Conversation } from "@/components/ai-elements/conversation";
import { Message } from "@/components/ai-elements/message";
import { Card } from "@/components/ui/primitives";
import type { VizPayload } from "@/lib/types";
import { cn } from "@/lib/utils";

const VizRouter = lazy(() => import("@/components/viz/VizRouter").then((m) => ({ default: m.VizRouter })));

type SharedMessage = {
  id: string;
  role: "user" | "assistant";
  parts: unknown[];
  created_at: string;
};

type SharedConversationPayload = {
  conversation: {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
  };
  messages: SharedMessage[];
  artifacts: VizPayload[];
};

async function safeJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function SharedChatView() {
  const { token } = useParams<{ token: string }>();
  const [payload, setPayload] = useState<SharedConversationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("Missing share token.");
      return;
    }

    const abortController = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/shared/${token}`, { signal: abortController.signal })
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 404) {
            setError("This shared conversation does not exist or is no longer public.");
            return;
          }
          setError(`Unable to load shared conversation (${response.status}).`);
          return;
        }
        const data = await safeJson<SharedConversationPayload>(response);
        if (!data) {
          setError("Unexpected response while loading shared conversation.");
          return;
        }
        setPayload(data);
      })
      .catch((err) => {
        if (abortController.signal.aborted || err instanceof DOMException) return;
        setError("Unable to load shared conversation right now.");
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });

    return () => abortController.abort();
  }, [token]);

  useEffect(() => {
    if (!payload?.artifacts?.length) {
      setSelectedArtifactId(null);
      return;
    }
    if (!selectedArtifactId || !payload.artifacts.some((artifact) => artifact.id === selectedArtifactId)) {
      setSelectedArtifactId(payload.artifacts[0]?.id ?? null);
    }
  }, [payload?.artifacts, selectedArtifactId]);

  const uiMessages = useMemo<UIMessage[]>(
    () =>
      (payload?.messages ?? []).map((message) => ({
        id: message.id,
        role: message.role === "assistant" ? "assistant" : "user",
        parts: (message.parts ?? []) as UIMessage["parts"],
      })),
    [payload?.messages],
  );

  const selectedArtifact = useMemo(
    () => payload?.artifacts?.find((artifact) => artifact.id === selectedArtifactId) ?? payload?.artifacts?.[0] ?? null,
    [payload?.artifacts, selectedArtifactId],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-(--color-background) text-(--color-foreground)">
        <Card className="text-sm">Loading shared conversation...</Card>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-(--color-background) text-(--color-foreground)">
        <Card className="max-w-md text-sm">{error ?? "Shared conversation unavailable."}</Card>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen grid-cols-1 bg-(--color-background) text-(--color-foreground) md:grid-cols-[minmax(0,1fr)_320px]">
      <section className="flex min-h-0 flex-col">
        <div className="sticky top-0 z-10 border-b border-(--color-border) bg-(--color-background)/95 px-4 py-3 backdrop-blur-sm">
          <h1 className="truncate text-sm font-medium">{payload.conversation.title}</h1>
          <p className="text-xs text-(--color-muted-foreground)">Shared conversation (read-only)</p>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-6">
          {uiMessages.length === 0 ? (
            <div className="mx-auto max-w-2xl">
              <p className="text-sm text-(--color-muted-foreground)">No messages in this shared conversation yet.</p>
            </div>
          ) : (
            <Conversation>
              {uiMessages.map((message) => (
                <Message key={message.id} message={message} />
              ))}
            </Conversation>
          )}
        </div>
      </section>

      <aside className="border-l border-(--color-border) bg-(--color-sidebar)">
        <div className="border-b border-(--color-border) px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Artifacts</p>
        </div>
        <div className="flex min-h-0 h-full flex-col gap-3 p-3">
          {payload.artifacts.length === 0 ? (
            <div className="pt-4 text-center text-sm text-(--color-muted-foreground)">Charts and more will appear here.</div>
          ) : (
            <>
              <div className="space-y-1 overflow-y-auto">
                {payload.artifacts.map((artifact) => (
                  <button
                    key={artifact.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md border border-(--color-border) px-2 py-2 text-left text-xs transition-colors",
                      artifact.id === selectedArtifact?.id
                        ? "bg-[color-mix(in_oklch,var(--color-primary)_12%,var(--color-sidebar)_88%)]"
                        : "hover:bg-[color-mix(in_oklch,var(--color-foreground)_5%,transparent)]",
                    )}
                    onClick={() => setSelectedArtifactId(artifact.id)}
                  >
                    <BarChart3 className="h-3.5 w-3.5 shrink-0 text-(--color-muted-foreground)" />
                    <span className="truncate">{artifact.title ?? artifact.toolName}</span>
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {selectedArtifact ? (
                  <Suspense fallback={<div className="p-4 text-center text-xs text-(--color-muted-foreground)">Loading...</div>}>
                    <VizRouter payload={selectedArtifact} />
                  </Suspense>
                ) : null}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
