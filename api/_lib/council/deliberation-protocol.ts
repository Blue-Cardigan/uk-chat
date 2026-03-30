// Copied from explore-the-kingdom worktree and adapted on 2026-03-30.
import type { CouncilAgent, CouncilDeliberationTurn, CouncilResolution, CouncilRoutingDecision } from "./types.js";

export const COUNCIL_DELIBERATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["turns", "resolution"],
  properties: {
    turns: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        required: ["agent_id", "agent_name", "agent_title", "move", "content", "cites"],
        properties: {
          agent_id: { type: "string" },
          agent_name: { type: "string" },
          agent_title: { type: "string" },
          move: {
            type: "string",
            enum: ["acknowledge", "challenge", "propose_action", "cite_constraint", "refer_to_other_body", "synthesize"],
          },
          content: { type: "string" },
          cites: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
    resolution: {
      type: "object",
      required: ["actionable_steps", "where_to_escalate", "constraints", "dissenting_views", "confidence"],
      properties: {
        actionable_steps: { type: "array", items: { type: "string" } },
        where_to_escalate: { type: "array", items: { type: "string" } },
        constraints: { type: "array", items: { type: "string" } },
        dissenting_views: { type: "array", items: { type: "string" } },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
      },
    },
  },
};

export function buildCouncilSystemPrompt(args: {
  routing: CouncilRoutingDecision;
  agents: CouncilAgent[];
  maxRounds?: number;
}): string {
  const maxRounds = args.maxRounds ?? 3;
  const lines: string[] = [
    "You are running a UK civic deliberation simulation.",
    "All speakers are simulated based on public role data and must stay within legal and democratic boundaries.",
    "Never claim a representative can do something outside their lawful powers.",
    "Respect fiscal and political constraints (budget pressures, statutory duties, committee process).",
    "Use British English spelling throughout (for example: organisation, recognise, colour, centre, programme).",
    `Run a concise deliberation with a maximum of ${maxRounds} rounds.`,
    "Each speaker turn should be 2-4 sentences and concrete.",
    "Preserve disagreement; include dissenting views in the final resolution.",
    "",
    "Routing context:",
    `- Category: ${args.routing.issueCategory}`,
    `- Institutions: ${args.routing.institutions.join(", ")}`,
    `- Rationale: ${args.routing.rationale}`,
    "",
    "Legal boundaries to enforce:",
    ...args.routing.legalBoundaries.map((item) => `- ${item}`),
    "",
    "Agents:",
    ...args.agents.map((agent) => {
      return `- ${agent.id} | ${agent.name} | ${agent.title} | ${agent.profileContext}`;
    }),
    "",
    "Output strict JSON matching the supplied schema.",
  ];
  return lines.join("\n");
}

export function buildCouncilUserPrompt(args: {
  issue: string;
  contextName: string;
  followUp?: string | null;
}): string {
  return [
    `Context: ${args.contextName}`,
    `Primary issue: ${args.issue}`,
    args.followUp ? `Follow-up request: ${args.followUp}` : null,
    "Deliberate between the relevant MPs and councillors, then provide an actionable resolution.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function normalizeCouncilTurns(raw: unknown): CouncilDeliberationTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const content = typeof row.content === "string" ? row.content.trim() : "";
      const move = typeof row.move === "string" ? row.move : "";
      if (!content || !move) return null;
      return {
        turnIndex: idx,
        agentId: typeof row.agent_id === "string" ? row.agent_id : `agent-${idx + 1}`,
        agentName: typeof row.agent_name === "string" ? row.agent_name : "Representative",
        agentTitle: typeof row.agent_title === "string" ? row.agent_title : "Representative",
        move: move as CouncilDeliberationTurn["move"],
        content,
        cites: Array.isArray(row.cites)
          ? row.cites.map((value) => (typeof value === "string" ? value.trim() : "")).filter((value) => value.length > 0)
          : [],
      };
    })
    .filter((row): row is CouncilDeliberationTurn => Boolean(row));
}

export function normalizeCouncilResolution(raw: unknown): CouncilResolution {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const stringList = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item.length > 0)
      : [];
  const confidenceRaw = typeof row.confidence === "string" ? row.confidence : "medium";
  const confidence = confidenceRaw === "low" || confidenceRaw === "high" ? confidenceRaw : "medium";
  return {
    actionableSteps: stringList(row.actionable_steps),
    whereToEscalate: stringList(row.where_to_escalate),
    constraints: stringList(row.constraints),
    dissentingViews: stringList(row.dissenting_views),
    confidence,
  };
}

