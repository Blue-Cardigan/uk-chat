// Data-handle pattern.
//
// Large tool outputs (e.g. police_fetchCrimes returning 8000+ rows) are too
// big for the LLM to read or aggregate reliably. This module wraps tool
// results so the LLM only sees:
//   - schema (column names) and total row count for substantive grounding
//   - any tool-supplied aggregates (byMonth, byCategory, …) bubbled up
//   - a small sample (3 rows, value-truncated) as concrete evidence
//   - a string `dataRef` it can pass to create_chart for ad-hoc grouping
//
// The actual rows are kept in a per-request cache. create_chart resolves
// dataRef + transform server-side, applies grouping/aggregation, and
// materialises the chart's `data` field — all without the model ever seeing
// the bulk payload. This pattern is sometimes called "data references" or
// "dereferenced data" in agent-framework literature.

import { isRecord } from "../../src/shared/type-guards.js";

const SAMPLE_ROW_COUNT = 3;
const SAMPLE_VALUE_MAX_CHARS = 220;
const MIN_ROW_COUNT_TO_HANDLE = 50;
// Top-level keys that should be bubbled up from the inner payload to the
// lean summary, keeping the model's view dense and chart-ready.
const AGGREGATE_KEYS = [
  "byMonth",
  "byCategory",
  "byMonthCategory",
  "byArea",
  "byRegion",
  "byParty",
  "byOutcome",
  "byYear",
  "byKind",
];

export type CachedDataset = {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  sourceTool: string;
  createdAt: number;
};

export type DataCache = Map<string, CachedDataset>;

export function createDataCache(): DataCache {
  return new Map();
}

export function generateDataRef(): string {
  // crypto.randomUUID exists in modern Node and in Workers
  const uuid = crypto.randomUUID();
  return `data_${uuid.replace(/-/g, "").slice(0, 12)}`;
}

function isRecordArray(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isRecord(item));
}

function findLargestRecordArrayPath(
  value: unknown,
  path: string[] = [],
  best: { path: string[]; rows: Array<Record<string, unknown>> } | null = null,
): { path: string[]; rows: Array<Record<string, unknown>> } | null {
  if (Array.isArray(value)) {
    if (isRecordArray(value)) {
      if (!best || value.length > best.rows.length) {
        return { path, rows: value };
      }
    }
    return best;
  }
  if (!isRecord(value)) return best;
  let current = best;
  for (const [key, child] of Object.entries(value)) {
    current = findLargestRecordArrayPath(child, [...path, key], current);
  }
  return current;
}

function unwrapMcpToolText(value: unknown): unknown {
  // MCP tool results commonly arrive as `{ content: [{ type:"text", text:"<json>" }] }`.
  // We need to dig into the JSON to find the rows; rewrap on the way out.
  if (!isRecord(value)) return value;
  const content = value.content;
  if (!Array.isArray(content) || content.length === 0) return value;
  const first = content[0];
  if (!isRecord(first) || typeof first.text !== "string") return value;
  try {
    return JSON.parse(first.text);
  } catch {
    return value;
  }
}

function rewrapAsMcpToolText(value: unknown): unknown {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value),
      },
    ],
  };
}

function truncateValue(value: unknown): unknown {
  if (typeof value === "string" && value.length > SAMPLE_VALUE_MAX_CHARS) {
    return `${value.slice(0, SAMPLE_VALUE_MAX_CHARS)}…`;
  }
  return value;
}

function compactSampleRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = truncateValue(v);
  }
  return out;
}

/**
 * Insert the lean summary into the unwrapped result, replacing the rows
 * array at its discovered path with a marker. Aggregates are bubbled up.
 */
function buildLeanSummary(
  unwrapped: unknown,
  rowsPath: string[],
  rows: Array<Record<string, unknown>>,
  dataRef: string,
  toolName: string,
): unknown {
  if (!isRecord(unwrapped)) {
    return {
      ok: true,
      tool: toolName,
      dataRef,
      totalRows: rows.length,
      columns: Object.keys(rows[0] ?? {}),
      sampleRows: rows.slice(0, SAMPLE_ROW_COUNT).map(compactSampleRow),
      hint:
        "The full row set is held server-side under `dataRef`. Pass the dataRef to create_chart with `transform: { groupBy: \"<column>\" }` to render any chart from this data without re-quoting the rows. Pre-built aggregates (when present) live alongside; prefer those for known views.",
    };
  }

  // Walk the unwrapped structure, replacing rowsPath with a tiny marker.
  const cloned = JSON.parse(JSON.stringify(unwrapped)) as Record<string, unknown>;
  let cursor: unknown = cloned;
  for (let i = 0; i < rowsPath.length - 1; i += 1) {
    if (!isRecord(cursor)) break;
    cursor = (cursor as Record<string, unknown>)[rowsPath[i]];
  }
  if (isRecord(cursor) && rowsPath.length > 0) {
    const lastKey = rowsPath[rowsPath.length - 1];
    (cursor as Record<string, unknown>)[lastKey] = `<${rows.length} rows held server-side under dataRef>`;
  }

  // Bubble aggregates from the inner payload to top level for easy reading.
  const innerPayload = isRecord(cloned.payload) ? (cloned.payload as Record<string, unknown>) : cloned;
  const bubbled: Record<string, unknown> = {};
  for (const key of AGGREGATE_KEYS) {
    if (innerPayload[key] !== undefined) bubbled[key] = innerPayload[key];
  }

  return {
    ...cloned,
    dataRef,
    totalRows: rows.length,
    columns: Object.keys(rows[0] ?? {}),
    sampleRows: rows.slice(0, SAMPLE_ROW_COUNT).map(compactSampleRow),
    ...bubbled,
    hint:
      Object.keys(bubbled).length > 0
        ? "Pre-built aggregates above (byMonth, byCategory, …) are chart-ready. For ad-hoc grouping, pass `dataRef` to create_chart with `transform: { groupBy: \"<column>\" }`."
        : "Full row set held server-side under `dataRef`. Pass the dataRef to create_chart with `transform: { groupBy: \"<column>\" }` to render any chart without re-quoting the rows.",
  };
}

/**
 * Wrap a tool's execute() so its result is post-processed:
 *   - Find the largest record array in the response
 *   - If it has ≥ MIN_ROW_COUNT_TO_HANDLE rows, store under a dataRef
 *   - Return a lean summary (schema + aggregates + 3 sample rows + dataRef)
 *
 * The original wrapper preserves the MCP `{content: [{type: "text", text}]}`
 * envelope so downstream code keeps working unchanged.
 */
export function wrapToolWithDataHandle(
  toolName: string,
  originalExecute: (input: unknown) => Promise<unknown> | unknown,
  cache: DataCache,
): (input: unknown) => Promise<unknown> {
  return async (input: unknown) => {
    const raw = await originalExecute(input);
    const wasMcpTextEnvelope = isRecord(raw) && Array.isArray((raw as { content?: unknown }).content);
    const unwrapped = wasMcpTextEnvelope ? unwrapMcpToolText(raw) : raw;
    const found = findLargestRecordArrayPath(unwrapped);
    if (!found || found.rows.length < MIN_ROW_COUNT_TO_HANDLE) {
      return raw;
    }
    const dataRef = generateDataRef();
    cache.set(dataRef, {
      rows: found.rows,
      columns: Object.keys(found.rows[0] ?? {}),
      sourceTool: toolName,
      createdAt: Date.now(),
    });
    const lean = buildLeanSummary(unwrapped, found.path, found.rows, dataRef, toolName);
    return wasMcpTextEnvelope ? rewrapAsMcpToolText(lean) : lean;
  };
}

/**
 * Apply a transform to cached rows, returning a new array suitable for use
 * as a chart's `data` field. Supports groupBy + metric (count/sum/avg).
 */
export type DataTransform = {
  groupBy?: string;
  groupBySecondary?: string;
  metric?:
    | { op: "count" }
    | { op: "sum" | "avg" | "min" | "max"; field: string };
  topN?: number;
  sortBy?: "value" | "key";
  sortDir?: "asc" | "desc";
};

export function applyTransform(
  rows: Array<Record<string, unknown>>,
  transform: DataTransform,
): Array<Record<string, unknown>> {
  const groupBy = transform.groupBy;
  const metricOp = transform.metric?.op ?? "count";
  const metricField = transform.metric && "field" in transform.metric ? transform.metric.field : null;
  const sortBy = transform.sortBy ?? (metricOp === "count" ? "value" : "value");
  const sortDir = transform.sortDir ?? "desc";
  const topN = transform.topN ?? Number.POSITIVE_INFINITY;

  if (!groupBy) {
    return rows.slice(0, Number.isFinite(topN) ? topN : rows.length);
  }

  // Aggregate
  const buckets = new Map<string, { sum: number; count: number; min: number; max: number; raw: number[] }>();
  for (const row of rows) {
    const key = String(row[groupBy] ?? "unknown");
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { sum: 0, count: 0, min: Infinity, max: -Infinity, raw: [] };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (metricField) {
      const numeric = Number(row[metricField]);
      if (Number.isFinite(numeric)) {
        bucket.sum += numeric;
        bucket.min = Math.min(bucket.min, numeric);
        bucket.max = Math.max(bucket.max, numeric);
        bucket.raw.push(numeric);
      }
    }
  }

  const aggregated: Array<{ key: string; value: number }> = [];
  for (const [key, bucket] of buckets.entries()) {
    let value: number;
    switch (metricOp) {
      case "sum":
        value = bucket.sum;
        break;
      case "avg":
        value = bucket.raw.length > 0 ? bucket.sum / bucket.raw.length : 0;
        break;
      case "min":
        value = bucket.min === Infinity ? 0 : bucket.min;
        break;
      case "max":
        value = bucket.max === -Infinity ? 0 : bucket.max;
        break;
      default:
        value = bucket.count;
    }
    aggregated.push({ key, value });
  }

  aggregated.sort((a, b) => {
    if (sortBy === "key") {
      return sortDir === "asc" ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key);
    }
    return sortDir === "asc" ? a.value - b.value : b.value - a.value;
  });

  return aggregated.slice(0, Number.isFinite(topN) ? topN : aggregated.length).map((entry) => ({
    [groupBy]: entry.key,
    value: entry.value,
  }));
}

export function resolveDataRef(cache: DataCache, dataRef: string | null | undefined): CachedDataset | null {
  if (!dataRef) return null;
  return cache.get(dataRef) ?? null;
}

/**
 * If the chart-tool input carries a `dataRef` + `transform`, look up the rows
 * in the cache and materialise the chart's `data` field. Otherwise pass the
 * input through unchanged.
 */
export function materialiseChartInput(input: unknown, cache: DataCache): unknown {
  if (!isRecord(input)) return input;
  const dataRef = typeof input.dataRef === "string" ? input.dataRef : null;
  const transformRaw = isRecord(input.transform) ? (input.transform as DataTransform) : null;
  if (!dataRef) return input;
  const cached = resolveDataRef(cache, dataRef);
  if (!cached) {
    return {
      ...input,
      // Surface a clear error so the model can recover rather than silently
      // handing the renderer an empty `data: []`.
      _dataRefError: `dataRef "${dataRef}" not found in this turn's cache. Re-fetch the source tool or pass inline data.`,
    };
  }
  const transform: DataTransform = transformRaw ?? {};
  const rows = applyTransform(cached.rows, transform);

  // If the model didn't supply xField/yFields, infer them from the transform
  // shape: groupBy → xField, "value" → yFields[0].
  const inferredXField = transform.groupBy && !input.xField ? transform.groupBy : input.xField;
  const inferredYFields =
    Array.isArray(input.yFields) && input.yFields.length > 0
      ? input.yFields
      : transform.groupBy
        ? ["value"]
        : input.yFields;

  return {
    ...input,
    xField: inferredXField,
    yFields: inferredYFields,
    data: rows,
    _dataRefMeta: {
      sourceTool: cached.sourceTool,
      totalRows: cached.rows.length,
      groupBy: transform.groupBy ?? null,
      metricOp: transform.metric?.op ?? "count",
    },
  };
}
