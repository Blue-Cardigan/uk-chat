import test from "node:test";
import assert from "node:assert/strict";
import { routeModel } from "./model-router.js";
import type { AmbientContext } from "./ambient-context.js";

function emptyAmbient(): AmbientContext {
  return { postcodes: [], constituencies: [], mpsByName: [], lads: [], places: [], dates: [] };
}

const POSTCODE = {
  postcode: "SE1 1AA",
  latitude: 51.502,
  longitude: -0.092,
  parliamentaryConstituency: "Bermondsey and Old Southwark",
  adminDistrict: "Southwark",
  adminWard: "Riverside",
  region: "London",
  lsoa: "Southwark 002E",
  msoa: "Southwark 002",
};

test("routeModel picks flash for short, no-entity questions", () => {
  const decision = routeModel({
    query: "What's a constituency?",
    ambient: emptyAmbient(),
    messages: [],
  });
  assert.equal(decision.modelId, "flash");
});

test("routeModel picks sonnet for chart-explicit prompts with one entity", () => {
  const decision = routeModel({
    query: "Show recent crime in SE1 1AA as a bar chart",
    ambient: { ...emptyAmbient(), postcodes: [POSTCODE] },
    messages: [],
  });
  assert.equal(decision.modelId, "sonnet");
});

test("routeModel picks opus for multi-chart prompts", () => {
  const decision = routeModel({
    query: "For Bristol Central: show the trend as a line chart and the breakdown as a bar chart. Two charts please.",
    ambient: emptyAmbient(),
    messages: [],
  });
  assert.equal(decision.modelId, "opus");
});

test("routeModel picks opus for multi-entity comparisons", () => {
  const decision = routeModel({
    query: "Compare Bristol Central vs Manchester Central crime rates",
    ambient: { ...emptyAmbient(), postcodes: [POSTCODE, { ...POSTCODE, postcode: "M1 1AB" }] },
    messages: [],
  });
  assert.equal(decision.modelId, "opus");
});

test("routeModel picks opus on long prompts", () => {
  const decision = routeModel({
    query: Array.from({ length: 70 }, (_, i) => `word${i}`).join(" "),
    ambient: emptyAmbient(),
    messages: [],
  });
  assert.equal(decision.modelId, "opus");
});

test("routeModel picks sonnet for quantitative prompts with one entity (no chart)", () => {
  const decision = routeModel({
    query: "How many crimes in SE1 1AA last month",
    ambient: { ...emptyAmbient(), postcodes: [POSTCODE] },
    messages: [],
  });
  assert.equal(decision.modelId, "sonnet");
});

test("routeModel exposes signals for telemetry", () => {
  const decision = routeModel({
    query: "Show two charts of Bristol Central",
    ambient: emptyAmbient(),
    messages: [],
  });
  assert.equal(decision.signals.multipleChartsRequested, true);
  assert.match(decision.reason, /multi-chart/);
});
