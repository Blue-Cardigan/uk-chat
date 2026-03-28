import { VizRouter } from "@/components/viz/VizRouter";
import { Card } from "@/components/ui/primitives";
import { useAppStore } from "@/lib/store";

export function RightSidebar() {
  const payloads = useAppStore((state) => state.vizPayloads);

  return (
    <aside className="h-full w-full border-l border-[var(--color-border)] bg-[var(--color-sidebar)] p-3">
      <div className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Insights</h2>
      </div>
      <div className="flex h-[calc(100vh-8rem)] flex-col gap-3 overflow-y-auto">
        {payloads.length === 0 ? (
          <Card className="text-sm text-[var(--color-muted-foreground)]">
            Tool-driven visualizations appear here as the model queries UK data sources.
          </Card>
        ) : (
          payloads.map((payload) => <VizRouter key={payload.id} payload={payload} />)
        )}
      </div>
    </aside>
  );
}
