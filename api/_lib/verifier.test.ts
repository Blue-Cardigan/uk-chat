import test from "node:test";
import assert from "node:assert/strict";
import { summariseChartPart } from "./verifier.js";

test("summariseChartPart picks the largest yField value as the top row", () => {
  const part = {
    type: "tool-create_chart",
    state: "output-available",
    output: {
      type: "bar",
      title: "Crime by category",
      xField: "category",
      yFields: ["count"],
      data: [
        { category: "Theft", count: 120 },
        { category: "Anti-social", count: 312 },
        { category: "Burglary", count: 45 },
      ],
    },
  };
  const summary = summariseChartPart(part);
  assert.equal(summary?.title, "Crime by category");
  assert.equal(summary?.type, "bar");
  assert.equal(summary?.rowCount, 3);
  assert.deepEqual(summary?.topRow, { label: "Anti-social", value: 312 });
});

test("summariseChartPart returns null when output is not a record", () => {
  assert.equal(summariseChartPart({ type: "tool-create_chart", state: "output-available", output: null }), null);
});

test("summariseChartPart handles empty data array", () => {
  const part = {
    type: "tool-create_chart",
    state: "output-available",
    output: { type: "bar", title: "Empty", xField: "x", yFields: ["y"], data: [] },
  };
  const summary = summariseChartPart(part);
  assert.equal(summary?.rowCount, 0);
  assert.equal(summary?.topRow, null);
});

test("summariseChartPart respects multi-yField charts", () => {
  const part = {
    type: "tool-create_chart",
    state: "output-available",
    output: {
      type: "line",
      title: "Trend",
      xField: "month",
      yFields: ["revenue", "cost"],
      data: [
        { month: "2026-01", revenue: 100, cost: 60 },
        { month: "2026-02", revenue: 50, cost: 200 },
      ],
    },
  };
  const summary = summariseChartPart(part);
  // Largest single value across yFields is cost=200 in 2026-02
  assert.deepEqual(summary?.topRow, { label: "2026-02", value: 200 });
});
