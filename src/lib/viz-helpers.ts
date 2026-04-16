import { buildChartSpecFromVizHint, isChartSpec } from "@/lib/viz-data-parser";
import { isRecord } from "@/lib/utils";

export function normalizeVizToolName(toolName: string): string {
  return toolName
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function hasChartLikeShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (Array.isArray(value.series) || Array.isArray(value.datasets) || Array.isArray(value.points)) return true;
  if (isRecord(value.chart) || isRecord(value.plot) || isRecord(value.echarts) || isRecord(value.vega)) return true;
  return false;
}

export const ARTIFACT_TOOL_ALLOWLIST = new Set([
  "ons_fetchObservations",
  "nomis_fetchTable",
  "police_fetchCrimes",
  "ea_flood",
  "postcodes_lookup",
  "council_deliberation",
  "create_chart",
]);

export function isChartArtifactCandidate(toolName: string, data: unknown): boolean {
  if (normalizeVizToolName(toolName) === "create_chart" && isChartSpec(data)) return true;
  if (buildChartSpecFromVizHint(data)) return true;
  return hasChartLikeShape(data);
}

export function isVizArtifactCandidate(toolName: string, data: unknown): boolean {
  const normalizedName = normalizeVizToolName(toolName);
  if (ARTIFACT_TOOL_ALLOWLIST.has(normalizedName)) return true;
  return isChartArtifactCandidate(toolName, data);
}
