export type CouncilInstitution = "mp_office" | "local_council" | "planning_committee" | "licensing_committee" | "scrutiny_committee";

export type CouncilIssueCategory =
  | "housing"
  | "planning"
  | "transport"
  | "crime_asb"
  | "health"
  | "environment"
  | "cost_of_living"
  | "other";

export type CouncilEpistemicMove =
  | "acknowledge"
  | "challenge"
  | "propose_action"
  | "cite_constraint"
  | "refer_to_other_body"
  | "synthesize";

export type CouncilAgentKind = "mp" | "councillor" | "chair";

export type CouncilAgent = {
  id: string;
  kind: CouncilAgentKind;
  name: string;
  party: string | null;
  title: string;
  wardOrConstituency: string | null;
  committeeRoles: string[];
  contact: {
    email: string | null;
    phone: string | null;
    website: string | null;
  };
  focusAreas: string[];
  roleBoundaries: string[];
  imageUrl: string | null;
  profileContext: string;
};

export type CouncilRoutingDecision = {
  issueCategory: CouncilIssueCategory;
  institutions: CouncilInstitution[];
  rationale: string;
  legalBoundaries: string[];
};

export type CouncilDeliberationTurn = {
  turnIndex: number;
  agentId: string;
  agentName: string;
  agentTitle: string;
  move: CouncilEpistemicMove;
  content: string;
  cites: string[];
};

export type CouncilResolution = {
  actionableSteps: string[];
  whereToEscalate: string[];
  constraints: string[];
  dissentingViews: string[];
  confidence: "low" | "medium" | "high";
};

export type CouncilScope =
  | { kind: "postcode"; postcode: string }
  | { kind: "area"; area: string }
  | { kind: "national"; nation?: "uk" | "england" | "scotland" | "wales" | "northern_ireland" };

export type CouncilResolvedGeography = {
  scope: CouncilScope;
  displayName: string;
  postcode?: string | null;
  constituencyName?: string | null;
  constituencyCode?: string | null;
  localAuthorityName?: string | null;
  localAuthorityCode?: string | null;
  nation?: string | null;
};

export type CouncilDeliberation = {
  councilId: string;
  conversationId: string;
  issue: string;
  routing: CouncilRoutingDecision;
  agents: CouncilAgent[];
  turns: CouncilDeliberationTurn[];
  resolution: CouncilResolution;
  resolvedGeography: CouncilResolvedGeography;
  createdAt: string;
};

export type CouncilCreateRequest = {
  conversationId: string;
  issue: string;
  scope: CouncilScope;
  mcpToken?: string | null;
  modelId?: string | null;
};

export type CouncilFollowUpRequest = {
  councilId: string;
  followUp: string;
  mcpToken?: string | null;
  modelId?: string | null;
};

export type LocalMpApiResponse = {
  member?: {
    name_display_as: string;
    party?: string | null;
    constituency?: string | null;
    portrait_url?: string | null;
    thumbnail_url?: string | null;
    contact?: Array<{
      email?: string | null;
      phone?: string | null;
      website?: string | null;
    }>;
  } | null;
  committee_memberships?: Array<{ name: string }>;
  extras?: {
    focus_areas?: string[];
    prior_contributions?: string[];
  };
};

export type CouncillorRecord = {
  councillor_name: string;
  ward_name?: string | null;
  party_name?: string | null;
  profile_image_url?: string | null;
  emails?: string[];
  phones?: string[];
  roles?: string[];
  role_links?: Array<{ kind: "committee" | "outside_body"; name: string }>;
};

export type CouncillorsBundleLike = {
  matched_councils?: Array<{
    council: string;
    councillors: CouncillorRecord[];
  }>;
};

