import test from "node:test";
import assert from "node:assert/strict";
import { parseCouncilCreateRequest, parseCouncilFollowUpRequest } from "./schemas";

test("parseCouncilCreateRequest accepts postcode scope", () => {
  const parsed = parseCouncilCreateRequest({
    conversationId: "conv_123",
    issue: "Housing affordability and bus reliability in my area",
    scope: { kind: "postcode", postcode: "SE1 1AA" },
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.data.scope.kind, "postcode");
  assert.equal(parsed.data.scope.postcode, "SE1 1AA");
});

test("parseCouncilCreateRequest accepts national scope", () => {
  const parsed = parseCouncilCreateRequest({
    conversationId: "conv_123",
    issue: "NHS waiting times need national action",
    scope: { kind: "national", nation: "uk" },
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.data.scope.kind, "national");
});

test("parseCouncilFollowUpRequest validates follow-up length", () => {
  const parsed = parseCouncilFollowUpRequest({
    councilId: "council_1",
    followUp: "ok",
  });
  assert.equal(parsed.ok, false);
});

