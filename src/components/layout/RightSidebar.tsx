import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ChevronDown, Pin, PinOff, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useAppStore } from "@/lib/store";
import { apiFetchJson } from "@/lib/api";
import type { ArtifactLibrary, VizPayload } from "@/lib/types";
import { cn } from "@/lib/utils";

const VizRouter = lazy(() => import("@/components/viz/VizRouter").then((m) => ({ default: m.VizRouter })));

type Props = {
  authToken: string | null;
};

type ArtifactGroup = {
  id: string;
  title: string;
  updated_at: string;
  artifacts: VizPayload[];
};

function ArtifactPreview({
  artifact,
  expanded,
  pinned,
  onToggleExpanded,
  onTogglePinned,
}: {
  artifact: VizPayload;
  expanded: boolean;
  pinned: boolean;
  onToggleExpanded: () => void;
  onTogglePinned: () => void;
}) {
  const label = artifact.chartSpec?.title ?? artifact.title ?? artifact.toolName;

  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left text-xs text-(--color-muted-foreground) hover:text-(--color-foreground)"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
        >
          <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", expanded ? "rotate-0" : "-rotate-90")} />
          <span className="truncate">{label}</span>
        </button>
        <Button
          type="button"
          variant="ghost"
          aria-label={pinned ? "Unpin artifact" : "Pin artifact as context"}
          className={cn(
            "h-6 w-6 p-0",
            pinned ? "text-(--color-primary)" : "text-(--color-muted-foreground)",
          )}
          onClick={onTogglePinned}
        >
          {pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
        </Button>
      </div>
      {expanded ? (
        <div className="mt-1">
          <Suspense fallback={<div className="p-4 text-center text-xs text-(--color-muted-foreground)">Loading...</div>}>
            <VizRouter payload={artifact} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}

export function RightSidebar({ authToken }: Props) {
  const payloads = useAppStore((state) => state.vizPayloads);
  const artifactLibrary = useAppStore((state) => state.artifactLibrary);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const conversations = useAppStore((state) => state.conversations);
  const setArtifactLibrary = useAppStore((state) => state.setArtifactLibrary);
  const setRightSidebarOpen = useAppStore((state) => state.setRightSidebarOpen);
  const pinnedArtifacts = useAppStore((state) => state.pinnedArtifacts);
  const pinArtifact = useAppStore((state) => state.pinArtifact);
  const unpinArtifact = useAppStore((state) => state.unpinArtifact);
  const [expandedConversationIds, setExpandedConversationIds] = useState<Set<string>>(new Set());
  const [expandedArtifactIds, setExpandedArtifactIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!authToken) {
      setArtifactLibrary(null);
      return;
    }
    const abortController = new AbortController();
    const params = new URLSearchParams();
    if (activeConversationId) params.set("currentConversationId", activeConversationId);
    apiFetchJson<ArtifactLibrary>(`/api/artifacts?${params.toString()}`, {
      signal: abortController.signal,
      skipToast: true,
    })
      .then((payload) => {
        setArtifactLibrary(payload && Array.isArray(payload.conversations) ? payload : { conversations: [] });
      })
      .catch(() => {
        if (!abortController.signal.aborted) setArtifactLibrary({ conversations: [] });
      });
    return () => abortController.abort();
  }, [activeConversationId, authToken, setArtifactLibrary]);

  const groupedArtifacts = useMemo<ArtifactGroup[]>(() => {
    const byConversation = new Map<string, ArtifactGroup>();
    for (const conversation of artifactLibrary?.conversations ?? []) {
      byConversation.set(conversation.id, {
        id: conversation.id,
        title: conversation.title,
        updated_at: conversation.updated_at,
        artifacts: [...conversation.artifacts],
      });
    }

    const liveCurrentArtifacts = payloads.filter((payload) => payload.conversationId && payload.conversationId === activeConversationId);
    if (activeConversationId) {
      const conversationTitle = conversations.find((conversation) => conversation.id === activeConversationId)?.title ?? "Current conversation";
      const existing = byConversation.get(activeConversationId) ?? {
        id: activeConversationId,
        title: conversationTitle,
        updated_at: new Date().toISOString(),
        artifacts: [],
      };
      const deduped = [...liveCurrentArtifacts, ...existing.artifacts.filter((artifact) => !liveCurrentArtifacts.some((live) => live.id === artifact.id))];
      byConversation.set(activeConversationId, { ...existing, title: conversationTitle, artifacts: deduped });
    }

    const groups = Array.from(byConversation.values()).filter((group) => group.artifacts.length > 0);
    groups.sort((a, b) => {
      if (activeConversationId) {
        if (a.id === activeConversationId && b.id !== activeConversationId) return -1;
        if (b.id === activeConversationId && a.id !== activeConversationId) return 1;
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return groups;
  }, [activeConversationId, artifactLibrary?.conversations, conversations, payloads]);

  useEffect(() => {
    if (!activeConversationId) return;
    setExpandedConversationIds((current) => {
      const next = new Set(current);
      next.add(activeConversationId);
      return next;
    });
  }, [activeConversationId]);

  useEffect(() => {
    if (groupedArtifacts.length === 0) {
      setExpandedArtifactIds(new Set());
      return;
    }
  }, [groupedArtifacts.length]);

  function toggleConversationGroup(id: string) {
    setExpandedConversationIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleArtifact(id: string) {
    setExpandedArtifactIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-(--color-border) bg-(--color-sidebar)">
      <div className="flex items-center justify-between border-b border-(--color-border) px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Artifacts</p>
        <Button
          variant="ghost"
          aria-label="Close artifacts"
          className="h-7 w-7 p-0 opacity-70 hover:opacity-100"
          onClick={() => setRightSidebarOpen(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        {groupedArtifacts.length === 0 ? (
          <div className="pt-4 text-center text-sm text-(--color-muted-foreground)">
            No artifacts yet. Charts, maps, and data visualizations will appear here as you chat.
          </div>
        ) : (
          <div className="space-y-3 overflow-y-auto pb-2">
            {groupedArtifacts.map((group) => {
              const isExpanded = expandedConversationIds.has(group.id);
              return (
                <section key={group.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left text-(--color-muted-foreground) hover:text-(--color-foreground)"
                    onClick={() => toggleConversationGroup(group.id)}
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} artifacts for ${group.title}`}
                  >
                    <span className="truncate text-[11px] font-medium uppercase tracking-wide">
                      {group.title}
                    </span>
                    <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isExpanded ? "rotate-0" : "-rotate-90")} />
                  </button>
                  {isExpanded ? (
                    <div className="mt-1 space-y-1.5">
                      {group.artifacts.map((artifact) => {
                        const pinned = pinnedArtifacts.some((pinnedArtifact) => pinnedArtifact.id === artifact.id);
                        return (
                          <ArtifactPreview
                            key={artifact.id}
                            artifact={artifact}
                            expanded={expandedArtifactIds.has(artifact.id)}
                            pinned={pinned}
                            onToggleExpanded={() => toggleArtifact(artifact.id)}
                            onTogglePinned={() => {
                              if (pinned) unpinArtifact(artifact.id);
                              else pinArtifact(artifact);
                            }}
                          />
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
