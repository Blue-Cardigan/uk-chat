import { ChoroplethMap, FloodRiskMap, PointMap, PostcodeZoom } from "@/components/viz/maps/Maps";
import {
  ComparisonRadar,
  CompositionStack,
  DonutBreakdown,
  RankedBarChart,
  SparklineGrid,
  TimeSeriesLine,
} from "@/components/viz/charts/Charts";
import { ConstituencySnapshot, FloodAlertCard, FoodHygieneCard, MPProfile, NHSServiceCard, WeatherClimate } from "@/components/viz/profiles/Profiles";
import { CommitteeMemberList, HansardReader, InterestsPanel, QAPanel, VotingMatrix } from "@/components/viz/parliament/Parliament";
import { AreaScorecard, CostOfLivingSnapshot, DemographicPyramid, ElectionSwing, LocalServicesAudit, SyntheticPersona } from "@/components/viz/composite/Composite";
import { ContractsList, CouncillorDirectory, DataGrid, PlanningTimeline, TrafficCountChart, TubeStatusBoard } from "@/components/viz/tables/Tables";

export const toolToVisualization: Record<string, React.ComponentType> = {
  ons_fetchObservations: ChoroplethMap,
  nomis_fetchTable: ChoroplethMap,
  police_fetchCrimes: PointMap,
  ea_flood: FloodRiskMap,
  postcodes_lookup: PostcodeZoom,
  boe_series: TimeSeriesLine,
  metoffice_fetchSeries: TimeSeriesLine,
  dft_roadTraffic: CompositionStack,
  parliament_votes: VotingMatrix,
  parliament_fetchMembers: MPProfile,
  parliament_interests: InterestsPanel,
  parliament_questions: QAPanel,
  parliament_hansard: HansardReader,
  nhs_findServices: NHSServiceCard,
  fsa_search: FoodHygieneCard,
  councillors_search: CouncillorDirectory,
  contracts_search: ContractsList,
  planning_search: PlanningTimeline,
  tfl_fetch: TubeStatusBoard,
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

const chartToolNames = new Set<string>(["boe_series", "metoffice_fetchSeries", "dft_roadTraffic"]);

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

export function isChartArtifactCandidate(toolName: string, data: unknown): boolean {
  if (chartToolNames.has(normalizeVizToolName(toolName))) return true;
  return hasChartLikeShape(data);
}
