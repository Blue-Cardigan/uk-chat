import type { VizPayload } from "@/lib/types";
import { normalizeVizToolName, toolToVisualization } from "@/lib/viz-registry";
import { VisualizationCard } from "@/components/viz/VisualizationCard";
import { DataDrivenChart } from "@/components/viz/charts/DataDrivenChart";
import { isChartSpec } from "@/lib/viz-data-parser";

function isSynthesizedToolError(data: unknown): data is { error?: string; synthesized?: boolean; isError?: boolean } {
  return (
    typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    ("synthesized" in data || ("isError" in data && (data as { isError?: unknown }).isError === true))
  );
}

export function VizRouter({ payload }: { payload: VizPayload }) {
  // Synthesized errors from message-utils.ts:ensureToolResultsPaired indicate
  // the model emitted a tool call but the tool's result never streamed back
  // (commonly Gemini Flash terminating a stream mid-tool-call). Surface this
  // explicitly instead of falling through to "Unsupported visualization type"
  // which is misleading.
  if (isSynthesizedToolError(payload.data)) {
    const errorMessage =
      typeof payload.data.error === "string"
        ? payload.data.error
        : "Tool execution did not produce a result.";
    return (
      <VisualizationCard title={payload.title ?? payload.toolName}>
        <p className="text-xs text-(--color-muted-foreground)">
          The model attempted to render this artifact but the tool stream ended before a result was returned. This usually means the model (often a streaming Gemini variant) cut off mid-call. Re-running the prompt typically resolves it.
        </p>
        <p className="mt-2 text-[11px] text-(--color-muted-foreground) italic">
          Reason: {errorMessage}
        </p>
      </VisualizationCard>
    );
  }

  if (isChartSpec(payload.chartSpec)) {
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
