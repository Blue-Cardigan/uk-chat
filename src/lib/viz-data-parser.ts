import type { ChartSpec } from "@/lib/types";

type JsonRecord = Record<string, unknown>;

type VizHint = {
  suggested?: string;
  xField?: string;
  yFields?: string[];
  labelField?: string;
  groupField?: string;
  latField?: string;
  lngField?: string;
  codeField?: string;
  valueField?: string;
  note?: string;
};

export type OverlayPoint = {
  lng: number;
  lat: number;
  label?: string;
  value?: number;
  category?: string;
};

export type ChoroplethEntry = {
  code: string;
  value: number;
  label?: string;
};

export type FocusPoint = {
  lng: number;
  lat: number;
  label?: string;
  zoom?: number;
};

export type MapOverlayData =
  | { kind: "choropleth"; entries: ChoroplethEntry[]; codeField: string; valueField: string }
  | { kind: "points"; items: OverlayPoint[] }
  | { kind: "focus"; point: FocusPoint };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = parseJson(value);
  return isRecord(parsed) ? parsed : null;
}

function unwrapToolOutput(input: unknown): JsonRecord | null {
  const direct = asRecord(input);
  if (!direct) return null;
  if ("vizHint" in direct || "payload" in direct) return direct;

  const content = direct.content;
  if (!Array.isArray(content)) return direct;
  for (const entry of content) {
    if (!isRecord(entry)) continue;
    if (typeof entry.text !== "string") continue;
    const parsed = asRecord(entry.text);
    if (parsed) return parsed;
  }
  return direct;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function sanitizeCell(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(sanitizeCell(current));
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(sanitizeCell(current));
  return cells;
}

export function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  if (headers.length === 0) return [];

  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      const key = header || `col_${index + 1}`;
      row[key] = values[index] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function parseDelimitedText(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const delimiter = headerLine.includes("\t") ? "\t" : /\s{2,}/.test(headerLine) ? /\s{2,}/ : null;
  if (!delimiter) return [];

  const headers = headerLine
    .split(delimiter)
    .map((header) => header.trim())
    .filter((header) => header.length > 0);
  if (headers.length === 0) return [];

  return lines.slice(1).map((line) => {
    const cells = line.split(delimiter).map((cell) => cell.trim());
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
}

function parseKeyValueLines(text: string): Record<string, string>[] {
  const pairs = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(":"))
    .map((line) => {
      const separatorIndex = line.indexOf(":");
      return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()] as const;
    })
    .filter(([key, value]) => key.length > 0 && value.length > 0);
  if (pairs.length < 2) return [];
  return pairs.map(([metric, value]) => ({ metric, value }));
}

function parseTextRows(body: string): Record<string, string>[] {
  const delimited = parseDelimitedText(body);
  if (delimited.length > 0) return delimited;
  return parseKeyValueLines(body);
}

function stringifyFlatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function flattenRowInto(source: Record<string, unknown>, target: Record<string, string>, prefix = "", depth = 0): void {
  for (const [key, value] of Object.entries(source)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (isRecord(value) && depth < 2) {
      flattenRowInto(value, target, fullKey, depth + 1);
      continue;
    }

    const stringValue = stringifyFlatValue(value);
    target[fullKey] = stringValue;
    if (!(key in target)) {
      target[key] = stringValue;
    }
  }
}

export function parseMCPPayload(payload: {
  format?: string;
  csv?: string;
  body?: string;
  rows?: unknown;
  records?: unknown;
  data?: unknown;
}): Record<string, string>[] {
  const arrayLike = payload.rows ?? payload.records ?? payload.data;
  if (Array.isArray(arrayLike)) {
    return arrayLike
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((row) => {
        const normalized: Record<string, string> = {};
        flattenRowInto(row, normalized);
        return normalized;
      });
  }

  if (payload.format === "csv" && typeof payload.csv === "string") {
    return parseCSV(payload.csv);
  }
  if (payload.format === "text" && typeof payload.body === "string") {
    return parseTextRows(payload.body);
  }
  if (typeof payload.csv === "string") {
    return parseCSV(payload.csv);
  }
  if (typeof payload.body === "string") {
    return parseTextRows(payload.body);
  }
  return [];
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[%£$,]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function coerceNumericFields(rows: Record<string, string>[], fields: string[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const nextRow: Record<string, unknown> = { ...row };
    for (const field of fields) {
      const value = toNumber(nextRow[field]);
      if (value !== null) nextRow[field] = value;
    }
    return nextRow;
  });
}

function mapSuggestedTypeToChartType(suggested: string | undefined): ChartSpec["type"] {
  if (!suggested) return "line";
  switch (suggested.toLowerCase()) {
    case "timeseries":
      return "line";
    case "bar":
      return "bar";
    case "scatter":
      return "scatter";
    case "table":
      return "table";
    default:
      return "line";
  }
}

function inferYFields(rows: Record<string, string>[], xField: string): string[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).filter((key) => key !== xField && toNumber(first[key]) !== null);
}

function dedupeStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim()))));
}

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function pickFieldByAliases(row: Record<string, string>, aliases: string[], preferred?: string): string | null {
  if (preferred && preferred in row) return preferred;
  const byExact = aliases.find((alias) => alias in row);
  if (byExact) return byExact;
  const normalizedAliases = aliases.map((alias) => normalizeFieldName(alias));
  const entries = Object.keys(row).map((key) => [key, normalizeFieldName(key)] as const);
  for (const alias of normalizedAliases) {
    const hit = entries.find(([, normalized]) => normalized === alias);
    if (hit) return hit[0];
  }
  return null;
}

function parseRowsFromNormalizedToolOutput(normalized: JsonRecord): Record<string, string>[] {
  if (Array.isArray(normalized.payload)) {
    return parseMCPPayload({ rows: normalized.payload });
  }
  const payload = isRecord(normalized.payload) ? normalized.payload : {};
  return parseMCPPayload({
    format: typeof payload.format === "string" ? payload.format : undefined,
    csv: typeof payload.csv === "string" ? payload.csv : undefined,
    body: typeof payload.body === "string" ? payload.body : undefined,
    rows: payload.rows,
    records: payload.records,
    data: payload.data,
  });
}

function toVizHint(value: unknown): VizHint {
  return isRecord(value) ? (value as VizHint) : {};
}

function pickNumericField(rows: Record<string, string>[], skipFields: Set<string>, preferred?: string): string | null {
  const first = rows[0];
  if (!first) return null;
  if (preferred && preferred in first) return preferred;
  for (const key of Object.keys(first)) {
    if (skipFields.has(key)) continue;
    const numericCount = rows.reduce((count, row) => (toNumber(row[key]) !== null ? count + 1 : count), 0);
    if (numericCount > 0) return key;
  }
  return null;
}

function extractPoints(rows: Record<string, string>[], vizHint: VizHint): OverlayPoint[] {
  const first = rows[0];
  if (!first) return [];
  const latField = pickFieldByAliases(first, ["lat", "latitude", "y"], vizHint.latField);
  const lngField = pickFieldByAliases(first, ["lng", "lon", "long", "longitude", "x"], vizHint.lngField);
  if (!latField || !lngField) return [];
  const labelField = pickFieldByAliases(first, ["label", "name", "postcode", "location", "area"], vizHint.labelField);
  const categoryField = pickFieldByAliases(
    first,
    ["category", "type", "severity", "risk", "warninglevel", "warning_level"],
    vizHint.groupField,
  );
  const valueField = pickFieldByAliases(first, ["value", "count", "score", "amount", "observation"], vizHint.valueField);

  const points: OverlayPoint[] = [];
  for (const row of rows) {
    const lat = toNumber(row[latField]);
    const lng = toNumber(row[lngField]);
    if (lat === null || lng === null) continue;
    const value = valueField ? toNumber(row[valueField]) : null;
    const label = labelField ? String(row[labelField] ?? "").trim() : "";
    const category = categoryField ? String(row[categoryField] ?? "").trim() : "";
    points.push({
      lat,
      lng,
      label: label || undefined,
      category: category || undefined,
      value: value ?? undefined,
    });
  }
  return points;
}

function extractChoropleth(rows: Record<string, string>[], vizHint: VizHint): MapOverlayData | null {
  const first = rows[0];
  if (!first) return null;
  const codeField = pickFieldByAliases(
    first,
    [
      "PCON24CD",
      "pcon24cd",
      "geography_code",
      "geography",
      "area_code",
      "lad_code",
      "local_authority_code",
      "gss_code",
      "ons_code",
      "code",
      "id",
    ],
    vizHint.codeField,
  );
  if (!codeField) return null;
  const labelField = pickFieldByAliases(first, ["label", "name", "area_name", "geography_name", "area"], vizHint.labelField);
  const skipFields = new Set([codeField]);
  if (labelField) skipFields.add(labelField);
  const valueField = pickNumericField(rows, skipFields, vizHint.valueField);
  if (!valueField) return null;

  const entries: ChoroplethEntry[] = [];
  for (const row of rows) {
    const code = String(row[codeField] ?? "").trim();
    const value = toNumber(row[valueField]);
    if (!code || value === null) continue;
    const label = labelField ? String(row[labelField] ?? "").trim() : "";
    entries.push({
      code,
      value,
      label: label || undefined,
    });
  }

  if (entries.length === 0) return null;
  return {
    kind: "choropleth",
    entries,
    codeField,
    valueField,
  };
}

export function extractMapData(toolOutput: unknown, mode: "auto" | "choropleth" | "points" | "focus" = "auto"): MapOverlayData | null {
  const normalized = unwrapToolOutput(toolOutput);
  if (!normalized) return null;
  const rows = parseRowsFromNormalizedToolOutput(normalized);
  if (rows.length === 0) return null;
  const vizHint = toVizHint(normalized.vizHint);

  if (mode === "choropleth") {
    return extractChoropleth(rows, vizHint);
  }

  if (mode === "points") {
    const points = extractPoints(rows, vizHint);
    return points.length > 0 ? { kind: "points", items: points } : null;
  }

  if (mode === "focus") {
    const points = extractPoints(rows, vizHint);
    const point = points[0];
    if (!point) return null;
    return {
      kind: "focus",
      point: {
        lat: point.lat,
        lng: point.lng,
        label: point.label,
      },
    };
  }

  const points = extractPoints(rows, vizHint);
  if (points.length > 0) return { kind: "points", items: points };
  return extractChoropleth(rows, vizHint);
}

export function buildChartSpecFromVizHint(toolOutput: unknown): ChartSpec | null {
  const normalized = unwrapToolOutput(toolOutput);
  if (!normalized) return null;

  const vizHintRaw = normalized.vizHint;
  if (!isRecord(vizHintRaw)) return null;
  const vizHint = vizHintRaw as VizHint;
  if (typeof vizHint.suggested === "string" && vizHint.suggested.toLowerCase() === "none") return null;
  if (typeof vizHint.suggested === "string" && vizHint.suggested.toLowerCase() === "map") return null;
  const rows = parseRowsFromNormalizedToolOutput(normalized);
  if (rows.length === 0) return null;

  const xField =
    typeof vizHint.xField === "string" && vizHint.xField.trim().length > 0
      ? vizHint.xField
      : Object.keys(rows[0])[0];
  if (!xField) return null;

  const yFields = toStringArray(vizHint.yFields);
  const inferredYFields = inferYFields(rows, xField);
  const finalYFields = yFields.length > 0 ? yFields.filter((field) => inferredYFields.includes(field) || field in rows[0]) : inferredYFields;
  if (finalYFields.length === 0 && mapSuggestedTypeToChartType(vizHint.suggested) !== "table") return null;

  const chartType = mapSuggestedTypeToChartType(vizHint.suggested);
  const data = coerceNumericFields(rows, finalYFields).filter((row) => {
    if (chartType === "table") return true;
    if (!(xField in row)) return false;
    return finalYFields.some((field) => typeof row[field] === "number");
  });
  if (data.length === 0) return null;
  const sourceName = typeof normalized.source === "string" ? normalized.source : undefined;
  const toolName = typeof normalized.tool === "string" ? normalized.tool : undefined;
  const titleTarget = toolName ?? sourceName ?? "Tool output";

  return {
    type: chartType,
    title: `Chart: ${titleTarget}`,
    xField,
    yFields: finalYFields,
    labelField: typeof vizHint.labelField === "string" ? vizHint.labelField : undefined,
    groupField: typeof vizHint.groupField === "string" ? vizHint.groupField : undefined,
    data,
    sources: dedupeStrings([toolName, sourceName]),
    note: typeof vizHint.note === "string" ? vizHint.note : undefined,
  };
}

export function isChartSpec(value: unknown): value is ChartSpec {
  if (!isRecord(value)) return false;
  if (typeof value.type !== "string") return false;
  if (typeof value.title !== "string") return false;
  if (typeof value.xField !== "string") return false;
  if (!Array.isArray(value.yFields)) return false;
  if (!Array.isArray(value.data)) return false;
  return true;
}
