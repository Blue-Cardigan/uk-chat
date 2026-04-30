import test from "node:test";
import assert from "node:assert/strict";
import { hasChartIntent } from "./tool-pipeline.js";

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
