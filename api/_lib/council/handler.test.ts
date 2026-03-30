import test from "node:test";
import assert from "node:assert/strict";
import { createCouncilDeliberation } from "./handler";
import type { CouncilAgent } from "./types";

function makeTools() {
  return {
    postcodes_lookup: {
      execute: async () => ({
        parliamentary_constituency: "Bristol West",
        parliamentary_constituency_code: "E14001033",
        local_authority: "Bristol",
        local_authority_code: "E06000023",
        country: "england",
      }),
    },
    parliament_fetchMembers: {
      execute: async () => ({
        member: {
          name_display_as: "Jordan Patel",
          party: "Labour",
          constituency: "Bristol West",
          contact: [],
        },
      }),
    },
    councillors_search: {
      execute: async () => ({
        matched_councils: [
          {
            council: "Bristol",
            councillors: [
              {
                councillor_name: "Casey Green",
                ward_name: "Central",
                party_name: "Green",
              },
            ],
          },
        ],
      }),
    },
  };
}

const deliberationStub = async ({
  agents,
}: {
  agents: CouncilAgent[];
}): Promise<{
  turns: Array<{
    turnIndex: number;
    agentId: string;
    agentName: string;
    agentTitle: string;
    move: "synthesize";
    content: string;
    cites: string[];
  }>;
  resolution: {
    actionableSteps: string[];
    whereToEscalate: string[];
    constraints: string[];
    dissentingViews: string[];
    confidence: "medium";
  };
  rawJson: unknown;
}> => ({
  turns: [
    {
      turnIndex: 0,
      agentId: agents[0]?.id ?? "agent:1",
      agentName: agents[0]?.name ?? "Representative",
      agentTitle: agents[0]?.title ?? "Representative",
      move: "synthesize",
      content: "Drafting a practical joint plan.",
      cites: [],
    },
  ],
  resolution: {
    actionableSteps: ["Start with a cross-party casework review"],
    whereToEscalate: ["Council scrutiny committee"],
    constraints: ["Budget cycle timing"],
    dissentingViews: [],
    confidence: "medium",
  },
  rawJson: {},
});

test("createCouncilDeliberation builds local council for postcode scope", async () => {
  const result = await createCouncilDeliberation({
    conversationId: "conv_1",
    issue: "Housing and transport are both deteriorating locally.",
    scope: { kind: "postcode", postcode: "BS1 4ST" },
    tools: makeTools(),
    model: {},
    deliberate: deliberationStub,
  });
  assert.equal(result.resolvedGeography.scope.kind, "postcode");
  assert.ok(result.agents.length >= 2);
  assert.equal(result.turns.length, 1);
});

test("createCouncilDeliberation builds national MP council", async () => {
  const tools = {
    parliament_fetchMembers: {
      execute: async () => [
        { name_display_as: "Rep One", party: "Labour", constituency: "Seat A" },
        { name_display_as: "Rep Two", party: "Conservative", constituency: "Seat B" },
      ],
    },
  };
  const result = await createCouncilDeliberation({
    conversationId: "conv_2",
    issue: "National strategy for NHS waiting lists.",
    scope: { kind: "national", nation: "uk" },
    tools,
    model: {},
    deliberate: deliberationStub,
  });
  assert.equal(result.resolvedGeography.scope.kind, "national");
  assert.ok(result.agents.some((agent) => agent.kind === "mp"));
});

