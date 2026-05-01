import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTransform,
  createDataCache,
  generateDataRef,
  materialiseChartInput,
  resolveDataRef,
  wrapToolWithDataHandle,
} from "./data-handle.js";

test("generateDataRef produces opaque, prefixed strings", () => {
  const ref = generateDataRef();
  assert.match(ref, /^data_[a-f0-9]{12}$/);
  assert.notEqual(generateDataRef(), ref);
});

test("wrapToolWithDataHandle stores rows server-side and returns a lean summary", async () => {
  const cache = createDataCache();
  const rows = Array.from({ length: 80 }, (_, i) => ({ id: i, category: i % 2 === 0 ? "a" : "b" }));
  const original = async () => ({ ok: true, payload: { rows } });
  const wrapped = wrapToolWithDataHandle("test_tool", original, cache);
  const result = (await wrapped({})) as Record<string, unknown>;
  assert.equal(result.totalRows, 80);
  assert.deepEqual(result.columns, ["id", "category"]);
  assert.equal(typeof result.dataRef, "string");
  assert.match(result.dataRef as string, /^data_/);
  // Sample is included for grounding, capped at 3 rows
  const sample = result.sampleRows as unknown[];
  assert.equal(sample.length, 3);
  // Cache contains all 80 rows under the dataRef
  const cached = resolveDataRef(cache, result.dataRef as string);
  assert.equal(cached?.rows.length, 80);
});

test("wrapToolWithDataHandle passes through when below threshold", async () => {
  const cache = createDataCache();
  const original = async () => ({ ok: true, payload: { rows: [{ a: 1 }, { a: 2 }] } });
  const wrapped = wrapToolWithDataHandle("test_tool", original, cache);
  const result = (await wrapped({})) as Record<string, unknown>;
  // No dataRef inserted because the array is too small
  assert.equal(result.dataRef, undefined);
  assert.equal(cache.size, 0);
});

test("wrapToolWithDataHandle preserves the MCP text envelope", async () => {
  const cache = createDataCache();
  const innerJson = JSON.stringify({
    payload: {
      crimes: Array.from({ length: 100 }, (_, i) => ({ id: i, category: "anti-social-behaviour", month: "2026-03" })),
    },
  });
  const original = async () => ({ content: [{ type: "text", text: innerJson }] });
  const wrapped = wrapToolWithDataHandle("police_fetchCrimes", original, cache);
  const result = (await wrapped({})) as { content?: Array<{ type: string; text: string }> };
  assert.ok(Array.isArray(result.content));
  const decoded = JSON.parse(result.content![0].text);
  assert.equal(decoded.totalRows, 100);
  assert.equal(typeof decoded.dataRef, "string");
});

test("wrapToolWithDataHandle bubbles known aggregates to top level", async () => {
  const cache = createDataCache();
  const inner = {
    ok: true,
    payload: {
      crimes: Array.from({ length: 60 }, (_, i) => ({ id: i, category: "x", month: "2026-03" })),
      byCategory: [{ category: "x", count: 60 }],
      byMonth: [{ month: "2026-03", count: 60 }],
    },
  };
  const original = async () => inner;
  const wrapped = wrapToolWithDataHandle("police_fetchCrimes", original, cache);
  const result = (await wrapped({})) as Record<string, unknown>;
  assert.deepEqual(result.byCategory, [{ category: "x", count: 60 }]);
  assert.deepEqual(result.byMonth, [{ month: "2026-03", count: 60 }]);
});

test("applyTransform groups by column with count metric", () => {
  const rows = [
    { category: "a", value: 1 },
    { category: "b", value: 2 },
    { category: "a", value: 3 },
    { category: "a", value: 4 },
  ];
  const out = applyTransform(rows, { groupBy: "category" });
  assert.deepEqual(out, [
    { category: "a", value: 3 },
    { category: "b", value: 1 },
  ]);
});

test("applyTransform supports sum metric on a numeric field", () => {
  const rows = [
    { region: "n", revenue: 10 },
    { region: "s", revenue: 5 },
    { region: "n", revenue: 7 },
  ];
  const out = applyTransform(rows, { groupBy: "region", metric: { op: "sum", field: "revenue" } });
  assert.deepEqual(out, [
    { region: "n", value: 17 },
    { region: "s", value: 5 },
  ]);
});

test("applyTransform respects topN and sortBy=key,asc", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ k: String.fromCharCode(97 + (i % 5)) }));
  const out = applyTransform(rows, { groupBy: "k", topN: 3, sortBy: "key", sortDir: "asc" });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((r) => r.k), ["a", "b", "c"]);
});

test("materialiseChartInput resolves dataRef + transform into chart `data`", () => {
  const cache = createDataCache();
  const ref = generateDataRef();
  cache.set(ref, {
    rows: [
      { category: "a" },
      { category: "b" },
      { category: "a" },
    ],
    columns: ["category"],
    sourceTool: "test",
    createdAt: Date.now(),
  });
  const expanded = materialiseChartInput(
    { type: "bar", title: "x", dataRef: ref, transform: { groupBy: "category" } },
    cache,
  ) as Record<string, unknown>;
  assert.equal(expanded.xField, "category");
  assert.deepEqual(expanded.yFields, ["value"]);
  assert.deepEqual(expanded.data, [
    { category: "a", value: 2 },
    { category: "b", value: 1 },
  ]);
});

test("materialiseChartInput returns input unchanged when no dataRef is set", () => {
  const cache = createDataCache();
  const input = { type: "bar", title: "x", data: [{ k: "a" }] };
  assert.equal(materialiseChartInput(input, cache), input);
});

test("materialiseChartInput surfaces a clear error when dataRef is unknown", () => {
  const cache = createDataCache();
  const out = materialiseChartInput(
    { type: "bar", title: "x", dataRef: "data_does_not_exist", transform: { groupBy: "category" } },
    cache,
  ) as Record<string, unknown>;
  assert.match(out._dataRefError as string, /not found/);
});
