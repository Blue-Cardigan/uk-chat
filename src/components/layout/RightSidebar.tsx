import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { BarChart3, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const VizRouter = lazy(() => import("@/components/viz/VizRouter").then((m) => ({ default: m.VizRouter })));

export function RightSidebar() {
  const payloads = useAppStore((state) => state.vizPayloads);
  const setRightSidebarOpen = useAppStore((state) => state.setRightSidebarOpen);
  const [selectedPayloadId, setSelectedPayloadId] = useState<string | null>(null);

  useEffect(() => {
    if (payloads.length === 0) {
      setSelectedPayloadId(null);
      return;
    }
    if (!selectedPayloadId || !payloads.some((payload) => payload.id === selectedPayloadId)) {
      setSelectedPayloadId(payloads[0]?.id ?? null);
    }
  }, [payloads, selectedPayloadId]);

  const selectedPayload = useMemo(
    () => payloads.find((payload) => payload.id === selectedPayloadId) ?? payloads[0] ?? null,
    [payloads, selectedPayloadId],
  );

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
        {payloads.length === 0 ? (
          <div className="pt-4 text-center text-sm text-(--color-muted-foreground)">Chart outputs will appear here.</div>
        ) : (
          <>
            <div className="space-y-1 overflow-y-auto">
              {payloads.map((payload) => (
                <button
                  key={payload.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md border border-(--color-border) px-2 py-2 text-left text-xs transition-colors",
                    payload.id === selectedPayload?.id
                      ? "bg-[color-mix(in_oklch,var(--color-primary)_12%,var(--color-sidebar)_88%)]"
                      : "hover:bg-[color-mix(in_oklch,var(--color-foreground)_5%,transparent)]",
                  )}
                  onClick={() => setSelectedPayloadId(payload.id)}
                >
                  <BarChart3 className="h-3.5 w-3.5 shrink-0 text-(--color-muted-foreground)" />
                  <span className="truncate">{payload.title ?? payload.toolName}</span>
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {selectedPayload ? (
                <Suspense fallback={<div className="p-4 text-center text-xs text-(--color-muted-foreground)">Loading...</div>}>
                  <VizRouter payload={selectedPayload} />
                </Suspense>
              ) : null}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
