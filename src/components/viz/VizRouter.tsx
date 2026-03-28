import type { VizPayload } from "@/lib/types";
import { toolToVisualization } from "@/lib/viz-registry";
import { VisualizationCard } from "@/components/viz/VisualizationCard";

export function VizRouter({ payload }: { payload: VizPayload }) {
  const Component = toolToVisualization[payload.toolName];
  if (!Component) {
    return (
      <VisualizationCard title={payload.title ?? payload.toolName}>
        <pre className="overflow-x-auto rounded-md bg-[var(--color-background)] p-2 text-xs">
          {JSON.stringify(payload.data, null, 2)}
        </pre>
      </VisualizationCard>
    );
  }

  return <Component />;
}
