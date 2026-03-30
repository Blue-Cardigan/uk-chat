import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCouncilResolution, normalizeCouncilTurns } from "./deliberation-protocol";

test("normalizeCouncilTurns filters malformed turns", () => {
  const turns = normalizeCouncilTurns([
    {
      agent_id: "mp:1",
      agent_name: "Alex Smith",
      agent_title: "MP",
      move: "propose_action",
      content: "We should request a formal review.",
      cites: ["Parliament", "Local authority budget"],
    },
    {
      move: "",
      content: "",
    },
  ]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.agentId, "mp:1");
});

test("normalizeCouncilResolution defaults confidence to medium", () => {
  const resolution = normalizeCouncilResolution({
    actionable_steps: ["Publish a timeline"],
    where_to_escalate: ["MP surgery"],
    constraints: ["Budget pressure"],
    dissenting_views: ["Prioritise transport first"],
    confidence: "unclear",
  });
  assert.equal(resolution.confidence, "medium");
  assert.equal(resolution.actionableSteps.length, 1);
});

