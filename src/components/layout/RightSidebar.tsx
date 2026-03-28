import { VizRouter } from "@/components/viz/VizRouter";
import { Card } from "@/components/ui/primitives";
import { useAppStore } from "@/lib/store";

export function RightSidebar() {
  const payloads = useAppStore((state) => state.vizPayloads);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-(--color-border) bg-(--color-sidebar) p-3">
      <div className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-(--color-muted-foreground)">Insights</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {payloads.length === 0 ? (
          <Card className="text-sm text-(--color-muted-foreground)">
            Tool-driven visualizations appear here as the model queries UK data sources.
          </Card>
        ) : (
          payloads.map((payload) => <VizRouter key={payload.id} payload={payload} />)
        )}
      </div>
    </aside>
  );
}
