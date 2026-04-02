import type { VizPayload } from "@/lib/types";
import { normalizeVizToolName, toolToVisualization } from "@/lib/viz-registry";
import { VisualizationCard } from "@/components/viz/VisualizationCard";
import { DataDrivenChart } from "@/components/viz/charts/DataDrivenChart";

export function VizRouter({ payload }: { payload: VizPayload }) {
  if (payload.chartSpec) {
    return <DataDrivenChart spec={payload.chartSpec} />;
  }

  const normalizedToolName = normalizeVizToolName(payload.toolName);
  const Component = toolToVisualization[normalizedToolName];
  if (!Component) {
    return (
      <VisualizationCard title={payload.title ?? payload.toolName}>
        <p className="mb-2 text-xs text-(--color-muted-foreground)">
          Unsupported visualization type. Showing the raw data payload below.
        </p>
        <pre className="overflow-x-auto rounded-md bg-(--color-background) p-2 text-xs">
          {JSON.stringify(payload.data, null, 2)}
        </pre>
      </VisualizationCard>
    );
  }

  return <Component payload={payload} />;
}
