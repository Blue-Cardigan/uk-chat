import test from "node:test";
import assert from "node:assert/strict";
import { findUnsubstantiatedNumbers, renderCitationNote } from "./citation-checker.js";

function chartPart(output: unknown) {
  return { type: "tool-create_chart", state: "output-available", output };
}
function dataPart(toolName: string, output: unknown) {
  return { type: `tool-${toolName}`, state: "output-available", output };
}
function textPart(text: string) {
  return { type: "text", text };
}

test("findUnsubstantiatedNumbers: numbers present in tool output pass", () => {
  const parts = [
    dataPart("police_fetchCrimes", { totalRows: 8375, byCategory: [{ category: "x", count: 312 }] }),
    chartPart({ type: "bar", data: [{ k: "x", v: 312 }] }),
    textPart("There were 8,375 crimes recorded; the top category had 312 incidents."),
  ];
  const result = findUnsubstantiatedNumbers(parts);
  assert.equal(result.unsubstantiated.length, 0);
});

test("findUnsubstantiatedNumbers flags hallucinated values", () => {
  const parts = [
    dataPart("police_fetchCrimes", { byCategory: [{ category: "x", count: 312 }] }),
    textPart("Anti-social behaviour rose to 1,793 incidents — a 25% jump."),
  ];
  const result = findUnsubstantiatedNumbers(parts);
  // 1,793 isn't in the tool output → flagged. 25% isn't either (and it isn't trivial).
  const flagged = result.unsubstantiated.map((u) => u.normalised);
  assert.ok(flagged.includes("1793"), `expected 1793 to be flagged, got ${flagged.join(",")}`);
});

test("findUnsubstantiatedNumbers ignores trivial single-digit references", () => {
  const parts = [
    dataPart("anything", { rows: [] }),
    textPart("There are 5 categories and 2 main groupings."),
  ];
  const result = findUnsubstantiatedNumbers(parts);
  assert.equal(result.unsubstantiated.length, 0);
});

test("findUnsubstantiatedNumbers respects thousands separators", () => {
  const parts = [
    dataPart("nomis", { totalRows: 12345 }),
    textPart("Population reached 12,345 last year."),
  ];
  const result = findUnsubstantiatedNumbers(parts);
  assert.equal(result.unsubstantiated.length, 0);
});

test("findUnsubstantiatedNumbers passes when nothing was substantive", () => {
  const parts = [textPart("Hello")];
  const result = findUnsubstantiatedNumbers(parts);
  assert.equal(result.total, 0);
});

test("renderCitationNote produces a user-visible self-check string", () => {
  const note = renderCitationNote({
    unsubstantiated: [{ raw: "1,793", normalised: "1793" }],
    total: 1,
  });
  assert.match(note ?? "", /self-check/);
  assert.match(note ?? "", /1,793/);
});

test("renderCitationNote returns null when no flags", () => {
  assert.equal(renderCitationNote({ unsubstantiated: [], total: 0 }), null);
});
