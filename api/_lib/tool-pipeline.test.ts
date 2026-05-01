import test from "node:test";
import assert from "node:assert/strict";
import { hasChartIntent, inferRecoveryHint } from "./tool-pipeline.js";

test("hasChartIntent matches explicit chart phrasing", () => {
  assert.equal(hasChartIntent("Show as a bar chart"), true);
  assert.equal(hasChartIntent("Plot the trend over 12 months"), true);
  assert.equal(hasChartIntent("Visualise crime by category"), true);
  assert.equal(hasChartIntent("Make a graph of the data"), true);
  assert.equal(hasChartIntent("Render a stacked breakdown"), true);
  assert.equal(hasChartIntent("Pie chart of the borough split please"), true);
});

test("hasChartIntent rejects neutral queries", () => {
  assert.equal(hasChartIntent("How many crimes in SE1?"), false);
  assert.equal(hasChartIntent("Summarise recent flood warnings"), false);
  assert.equal(hasChartIntent("Find me an MP for Bristol"), false);
});

test("hasChartIntent handles empty / nullish input", () => {
  assert.equal(hasChartIntent(""), false);
  assert.equal(hasChartIntent(null), false);
  assert.equal(hasChartIntent(undefined), false);
});

test("inferRecoveryHint catches postcode resolution failures generically", () => {
  const hint = inferRecoveryHint("police_fetchCrimes", `postcode "ZZ9 9ZZ" could not be resolved to coordinates.`);
  assert.match(hint ?? "", /nearby postcode/);
});

test("inferRecoveryHint suggests nomis_listDatasets on 404", () => {
  const hint = inferRecoveryHint("nomis_fetchTable", "HTTP 404: dataset NM_99999 not found");
  assert.match(hint ?? "", /nomis_listDatasets/);
});

test("inferRecoveryHint distinguishes police upstream from police empty", () => {
  const upstream = inferRecoveryHint("police_fetchCrimes", "502 bad gateway from data.police.uk");
  assert.match(upstream ?? "", /upstream is flaky/);
  const empty = inferRecoveryHint("police_fetchCrimes", "no crimes returned for the requested month");
  assert.match(empty ?? "", /lags 1–3 months/);
});

test("inferRecoveryHint catches schema-validation messages", () => {
  const hint = inferRecoveryHint("nomis_fetchTable", "missing required field: dataset");
  assert.match(hint ?? "", /required parameters/);
});

test("inferRecoveryHint flags rate limits + auth + timeouts", () => {
  assert.match(inferRecoveryHint("any", "429 too many requests") ?? "", /rate-limited/);
  assert.match(inferRecoveryHint("any", "403 forbidden") ?? "", /credentials/);
  assert.match(inferRecoveryHint("any", "request timed out after 30s") ?? "", /narrower scope/);
});

test("inferRecoveryHint returns undefined for unknown errors", () => {
  assert.equal(inferRecoveryHint("any", "something genuinely unknown"), undefined);
});
