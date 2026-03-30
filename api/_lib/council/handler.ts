import { buildCouncilAgents } from "./agent-builder.js";
import { fetchCouncilCouncillorsBundle, fetchLocalMpBundle, fetchNationalMpRepresentativeBundle } from "./data-bundles.js";
import { generateCouncilDeliberation } from "./deliberation.js";
import { routeIssueToInstitutions } from "./institutional-knowledge.js";
import { resolveCouncilScope } from "./scope-resolver.js";
import type { CouncilAgent, CouncilDeliberation, CouncilResolvedGeography, LocalMpApiResponse } from "./types.js";

type ToolMap = Record<string, unknown>;

function nowIso() {
  return new Date().toISOString();
}

function buildNationalAgents(mpBundles: LocalMpApiResponse[]): CouncilAgent[] {
  const agents: CouncilAgent[] = [];
  for (const [index, bundle] of mpBundles.entries()) {
    const name = bundle.member?.name_display_as ?? `Representative MP ${index + 1}`;
    const constituency = bundle.member?.constituency ?? "UK";
    agents.push({
      id: `mp:national-${index + 1}`,
      kind: "mp",
      name,
      party: bundle.member?.party ?? null,
      title: `MP (${constituency})`,
      wardOrConstituency: constituency,
      committeeRoles: [],
      contact: { email: null, phone: null, website: null },
      focusAreas: ["national policy", "constituency representation"],
      roleBoundaries: ["Cannot directly direct council statutory decision making."],
      imageUrl: bundle.member?.portrait_url ?? bundle.member?.thumbnail_url ?? null,
      profileContext: `Role: MP (${bundle.member?.party ?? "party unknown"})`,
    });
  }
  agents.push({
    id: "chair:system",
    kind: "chair",
    name: "Council Chair",
    party: null,
    title: "Deliberation Chair",
    wardOrConstituency: null,
    committeeRoles: [],
    contact: { email: null, phone: null, website: null },
    focusAreas: ["procedural fairness", "clarity", "actionable outcomes"],
    roleBoundaries: ["Must keep recommendations within UK institutional powers."],
    imageUrl: null,
    profileContext: "Neutral chair who keeps discussion grounded in powers and delivery constraints.",
  });
  return agents;
}

export async function createCouncilDeliberation(args: {
  conversationId: string;
  issue: string;
  scope: CouncilDeliberation["resolvedGeography"]["scope"];
  tools: ToolMap;
  model: unknown;
  deliberate?: typeof generateCouncilDeliberation;
}): Promise<Omit<CouncilDeliberation, "councilId">> {
  const routing = routeIssueToInstitutions(args.issue);
  const resolvedGeography = await resolveCouncilScope(args.scope, args.tools);

  let agents: CouncilAgent[] = [];
  if (resolvedGeography.scope.kind === "national") {
    const mpList = await fetchNationalMpRepresentativeBundle(args.tools, resolvedGeography.nation ?? null);
    agents = buildNationalAgents(mpList);
  } else {
    const mpData = await fetchLocalMpBundle(args.tools, resolvedGeography);
    const councillorsData = await fetchCouncilCouncillorsBundle(args.tools, resolvedGeography);
    agents = buildCouncilAgents({
      institutions: routing.institutions,
      mpData,
      councillorsData,
    });
  }

  const deliberate = args.deliberate ?? generateCouncilDeliberation;
  const deliberation = await deliberate({
    model: args.model,
    issue: args.issue,
    contextName: resolvedGeography.displayName,
    routing,
    agents,
  });

  return {
    conversationId: args.conversationId,
    issue: args.issue,
    routing,
    agents,
    turns: deliberation.turns,
    resolution: deliberation.resolution,
    resolvedGeography,
    createdAt: nowIso(),
  };
}

export async function continueCouncilDeliberation(args: {
  model: unknown;
  issue: string;
  followUp: string;
  routing: CouncilDeliberation["routing"];
  agents: CouncilAgent[];
  resolvedGeography: CouncilResolvedGeography;
  existingTurns: CouncilDeliberation["turns"];
  deliberate?: typeof generateCouncilDeliberation;
}): Promise<{ turns: CouncilDeliberation["turns"]; resolution: CouncilDeliberation["resolution"] }> {
  const deliberate = args.deliberate ?? generateCouncilDeliberation;
  const next = await deliberate({
    model: args.model,
    issue: args.issue,
    contextName: args.resolvedGeography.displayName,
    routing: args.routing,
    agents: args.agents,
    followUp: args.followUp,
  });
  const merged = [...args.existingTurns, ...next.turns]
    .slice(0, 24)
    .map((turn, index) => ({ ...turn, turnIndex: index }));
  return {
    turns: merged,
    resolution: next.resolution,
  };
}

