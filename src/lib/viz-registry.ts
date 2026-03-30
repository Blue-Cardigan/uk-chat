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
import type { VizPayload } from "@/lib/types";
export { normalizeVizToolName, isVizArtifactCandidate, isChartArtifactCandidate } from "@/lib/viz-helpers";

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
