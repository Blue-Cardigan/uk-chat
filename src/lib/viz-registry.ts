import { ChoroplethMap, FloodRiskMap, PointMap, PostcodeZoom } from "@/components/viz/maps/Maps";
import {
  ComparisonRadar,
  CompositionStack,
  DonutBreakdown,
  RankedBarChart,
  SparklineGrid,
  TimeSeriesLine,
} from "@/components/viz/charts/Charts";
import { ConstituencySnapshot, CouncilDeliberationCard, FloodAlertCard, FoodHygieneCard, MPProfile, NHSServiceCard, WeatherClimate } from "@/components/viz/profiles/Profiles";
import { CommitteeMemberList, HansardReader, InterestsPanel, QAPanel, VotingMatrix } from "@/components/viz/parliament/Parliament";
import { AreaScorecard, CostOfLivingSnapshot, DemographicPyramid, ElectionSwing, LocalServicesAudit, SyntheticPersona } from "@/components/viz/composite/Composite";
import { ContractsList, CouncillorDirectory, DataGrid, PlanningTimeline, TrafficCountChart, TubeStatusBoard } from "@/components/viz/tables/Tables";
import { buildChartSpecFromVizHint, isChartSpec } from "@/lib/viz-data-parser";
import type { VizPayload } from "@/lib/types";

const withPayload = <P extends object>(Component: React.ComponentType<P>): React.ComponentType<{ payload: VizPayload }> =>
  Component as unknown as React.ComponentType<{ payload: VizPayload }>;

export const toolToVisualization: Record<string, React.ComponentType<{ payload: VizPayload }>> = {
  ons_fetchObservations: withPayload(ChoroplethMap),
  nomis_fetchTable: withPayload(ChoroplethMap),
  police_fetchCrimes: withPayload(PointMap),
  ea_flood: withPayload(FloodRiskMap),
  postcodes_lookup: withPayload(PostcodeZoom),
  boe_series: withPayload(TimeSeriesLine),
  metoffice_fetchSeries: withPayload(TimeSeriesLine),
  dft_roadTraffic: withPayload(CompositionStack),
  parliament_votes: withPayload(VotingMatrix),
  parliament_fetchMembers: withPayload(MPProfile),
  parliament_interests: withPayload(InterestsPanel),
  parliament_questions: withPayload(QAPanel),
  parliament_hansard: withPayload(HansardReader),
  nhs_findServices: withPayload(NHSServiceCard),
  fsa_search: withPayload(FoodHygieneCard),
  councillors_search: withPayload(CouncillorDirectory),
  contracts_search: withPayload(ContractsList),
  planning_search: withPayload(PlanningTimeline),
  tfl_fetch: withPayload(TubeStatusBoard),
  council_deliberation: CouncilDeliberationCard,
};

export const showcaseVisualizations: React.ComponentType[] = [
  ChoroplethMap,
  PointMap,
  FloodRiskMap,
  PostcodeZoom,
  TimeSeriesLine,
  RankedBarChart,
  DonutBreakdown,
  CompositionStack,
  ComparisonRadar,
  SparklineGrid,
  MPProfile,
  ConstituencySnapshot,
  FoodHygieneCard,
  NHSServiceCard,
  WeatherClimate,
  FloodAlertCard,
  HansardReader,
  VotingMatrix,
  CommitteeMemberList,
  InterestsPanel,
  QAPanel,
  SyntheticPersona,
  AreaScorecard,
  LocalServicesAudit,
  ElectionSwing,
  DemographicPyramid,
  CostOfLivingSnapshot,
  DataGrid,
  ContractsList,
  PlanningTimeline,
  CouncillorDirectory,
  TubeStatusBoard,
  TrafficCountChart,
];

export function normalizeVizToolName(toolName: string): string {
  return toolName
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasChartLikeShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (Array.isArray(value.series) || Array.isArray(value.datasets) || Array.isArray(value.points)) return true;
  if (isRecord(value.chart) || isRecord(value.plot) || isRecord(value.echarts) || isRecord(value.vega)) return true;
  return false;
}

const MAP_TOOL_ALLOWLIST = new Set(["ons_fetchObservations", "nomis_fetchTable", "police_fetchCrimes", "ea_flood", "postcodes_lookup"]);

export function isChartArtifactCandidate(toolName: string, data: unknown): boolean {
  if (normalizeVizToolName(toolName) === "create_chart" && isChartSpec(data)) return true;
  if (buildChartSpecFromVizHint(data)) return true;
  return hasChartLikeShape(data);
}

export function isVizArtifactCandidate(toolName: string, data: unknown): boolean {
  const normalizedName = normalizeVizToolName(toolName);
  if (normalizedName === "council_deliberation") return true;
  if (MAP_TOOL_ALLOWLIST.has(normalizedName)) return true;
  return isChartArtifactCandidate(toolName, data);
}
