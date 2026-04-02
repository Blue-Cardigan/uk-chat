import { jsonSchema } from "ai";

export const CREATE_CHART_TOOL_NAME = "create_chart";

const MAX_TOOL_OUTPUT_DEPTH = 5;
const MAX_TOOL_OUTPUT_STRING = 8_000;
const MAX_TOOL_OUTPUT_ARRAY_ITEMS = 180;
const MAX_TOOL_OUTPUT_OBJECT_KEYS = 60;
const MAX_TOOL_BUDGET_FALLBACK_STRING = 2_000;

const CORE_GEOGRAPHY_TOOL_PATTERNS = [
  /^postcodes[_.-]/i,
  /^geo[_.-]/i,
  /^ons[_.-](fetchGeography|listGeographyLayers)/i,
];

const METADATA_TOOL_PATTERNS = [
  /(^|[_.-])(search|list|describe|catalog|datasets|layers)([_.-]|$)/i,
  /(^|[_.-])(lookup)([_.-]|$)/i,
];

type ToolCatalogItem = {
  name: string;
  description: string;
  category: "data" | "analysis" | "system";
  score: number;
  recommended: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function classifyTool(name: string, description: string): { category: "data" | "analysis" | "system"; baseScore: number } {
  const normalizedName = name.toLowerCase();
  const normalizedDescription = description.toLowerCase();
  if (normalizedName.includes("admin") || normalizedName.includes("auth") || normalizedDescription.includes("token")) {
    return { category: "system", baseScore: 20 };
  }
  if (
    normalizedName.includes("chart") ||
    normalizedName.includes("summar") ||
    normalizedName.includes("analy") ||
    normalizedDescription.includes("insight")
  ) {
    return { category: "analysis", baseScore: 60 };
  }
  return { category: "data", baseScore: 80 };
}

function buildToolCatalog(tools: Record<string, unknown>, query: string): ToolCatalogItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const catalog = Object.entries(tools)
    .map(([name, definition]) => {
      const description =
        (isRecord(definition) && typeof definition.description === "string" ? definition.description : "Model tool") ?? "Model tool";
      const shortDescription = description.length > 120 ? `${description.slice(0, 117)}...` : description;
      const { category, baseScore } = classifyTool(name, shortDescription);
      const startsWithVerb = /^(get|list|search|query|find|fetch)/i.test(name) ? 10 : 0;
      const conciseBonus = Math.max(0, 12 - Math.min(12, name.length));
      const trustedDataBonus = /ons|nomis|nhs|boe|postcodes|parliament|metoffice|dft|fsa/i.test(name) ? 14 : 0;
      const adminPenalty = category === "system" ? -40 : 0;
      const score = baseScore + startsWithVerb + conciseBonus + trustedDataBonus + adminPenalty;
      return {
        name,
        description: shortDescription,
        category,
        score,
        recommended: false,
      };
    })
    .filter((tool) => {
      if (!normalizedQuery) return true;
      const haystack = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });

  catalog.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let recommendedCount = 0;
  for (const tool of catalog) {
    if (recommendedCount >= 12) break;
    if (tool.category === "system") continue;
    tool.recommended = true;
    recommendedCount += 1;
  }
  return catalog;
}

function estimateToolPayloadChars(value: unknown): number {
  if (value == null) return 4;
  if (typeof value === "string") return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 1000;
  }
}

function compactToolOutputForModel(value: unknown, depth = 0): unknown {
  if (depth > MAX_TOOL_OUTPUT_DEPTH) return "[truncated: depth]";

  if (typeof value === "string") {
    if (value.length <= MAX_TOOL_OUTPUT_STRING) return value;
    return `${value.slice(0, MAX_TOOL_OUTPUT_STRING)}\n\n[truncated for model context]`;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;

  if (Array.isArray(value)) {
    const compacted = value.slice(0, MAX_TOOL_OUTPUT_ARRAY_ITEMS).map((item) => compactToolOutputForModel(item, depth + 1));
    if (value.length > MAX_TOOL_OUTPUT_ARRAY_ITEMS) {
      compacted.push(`[truncated: ${value.length - MAX_TOOL_OUTPUT_ARRAY_ITEMS} more items]`);
    }
    return compacted;
  }

  if (!isRecord(value)) return value;

  const entries = Object.entries(value);
  const compactedObject: Record<string, unknown> = {};
  for (const [index, [key, entry]] of entries.entries()) {
    if (index >= MAX_TOOL_OUTPUT_OBJECT_KEYS) {
      compactedObject.__truncated__ = `${entries.length - MAX_TOOL_OUTPUT_OBJECT_KEYS} more keys omitted`;
      break;
    }
    compactedObject[key] = compactToolOutputForModel(entry, depth + 1);
  }
  return compactedObject;
}

function needsGeographyTools(query: string): boolean {
  return /\b(borough|postcode|ward|constituency|county|district|authority|london|scotland|wales|england|northern ireland)\b/i.test(
    query,
  );
}

function addPrerequisiteTools(selectedNames: Set<string>, tools: Record<string, unknown>, query: string): void {
  if (!needsGeographyTools(query)) return;
  for (const toolName of Object.keys(tools)) {
    if (CORE_GEOGRAPHY_TOOL_PATTERNS.some((pattern) => pattern.test(toolName))) {
      selectedNames.add(toolName);
    }
  }
}

export function shouldRequireDataToolCall(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;

  const quantitativeSignals = [
    /\bcompare\b/,
    /\btrend\b/,
    /\bchange(?:d)?\b/,
    /\bhow many\b/,
    /\bhow much\b/,
    /\bnumber of\b/,
    /\bmonthly\b/,
    /\byearly\b/,
    /\bover the last\b/,
    /\b\d{4}\b/,
    /\bchart\b/,
    /\bgraph\b/,
    /\bborough\b/,
    /\bpostcode\b/,
    /\bcrime\b/,
    /\benergy\b/,
    /\belectricity\b/,
    /\bgas\b/,
  ];

  return quantitativeSignals.some((pattern) => pattern.test(normalized));
}

export function hasPriorNonChartToolOutput(messages: Array<{ role?: string; parts?: unknown[] }> | undefined): boolean {
  if (!Array.isArray(messages)) return false;
  for (const message of messages) {
    if (!message || !Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      if (!isRecord(part) || typeof part.type !== "string") continue;
      if (!part.type.startsWith("tool-")) continue;
      const toolName = part.type.slice("tool-".length);
      if (toolName !== CREATE_CHART_TOOL_NAME) return true;
    }
  }
  return false;
}

export function selectToolsForChat(tools: Record<string, unknown>, query: string, limit: number): Record<string, unknown> {
  const catalog = buildToolCatalog(tools, "");
  const keywords = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((keyword) => keyword.length >= 3);
  const ranked = [...catalog].sort((a, b) => {
    const aHaystack = `${a.name} ${a.description}`.toLowerCase();
    const bHaystack = `${b.name} ${b.description}`.toLowerCase();
    const aMatches = keywords.reduce((sum, keyword) => sum + (aHaystack.includes(keyword) ? 1 : 0), 0);
    const bMatches = keywords.reduce((sum, keyword) => sum + (bHaystack.includes(keyword) ? 1 : 0), 0);
    return bMatches - aMatches || b.score - a.score;
  });
  const selectedNames = new Set(ranked.slice(0, Math.max(10, limit)).map((item) => item.name));
  addPrerequisiteTools(selectedNames, tools, query);
  const selectedEntries = Object.entries(tools).filter(([name]) => selectedNames.has(name));
  return Object.fromEntries(selectedEntries);
}

const CREATE_CHART_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["type", "title", "xField", "yFields", "data"],
  properties: {
    type: { type: "string", enum: ["line", "bar", "scatter", "area", "pie", "table"] },
    title: { type: "string" },
    xField: { type: "string" },
    yFields: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
    labelField: { type: "string" },
    groupField: { type: "string" },
    data: {
      type: "array",
      maxItems: 160,
      items: {
        type: "object",
        additionalProperties: true,
      },
    },
    sources: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
};

export function createSyntheticChartTool(compactCreateChartSpec: (input: unknown) => unknown) {
  return {
    description: "Create a chart specification from one or more tool outputs.",
    inputSchema: jsonSchema(CREATE_CHART_INPUT_SCHEMA),
    execute: async (input: unknown) => compactCreateChartSpec(input),
  };
}

export function enforceCreateChartDataPrereq(tools: Record<string, unknown>): Record<string, unknown> {
  let hasCalledNonChartDataTool = false;

  const wrappedEntries = Object.entries(tools).map(([toolName, definition]) => {
    if (!isRecord(definition)) return [toolName, definition] as const;
    const execute = definition.execute;
    if (typeof execute !== "function") return [toolName, definition] as const;

    if (toolName === CREATE_CHART_TOOL_NAME) {
      return [
        toolName,
        {
          ...definition,
          execute: async (...args: unknown[]) => {
            if (!hasCalledNonChartDataTool) {
              return {
                error:
                  "create_chart requires at least one non-create_chart data tool call earlier in this turn. Call a data retrieval tool first, then synthesize with create_chart.",
              };
            }
            return execute(...args);
          },
        },
      ] as const;
    }

    return [
      toolName,
      {
        ...definition,
        execute: async (...args: unknown[]) => {
          hasCalledNonChartDataTool = true;
          return execute(...args);
        },
      },
    ] as const;
  });

  return Object.fromEntries(wrappedEntries);
}

export function compactMcpToolsForModelContext(
  tools: Record<string, unknown>,
  options?: { outputBudgetChars?: number },
): Record<string, unknown> {
  let totalOutputChars = 0;
  const budget = options?.outputBudgetChars ?? Number.POSITIVE_INFINITY;

  const compactedEntries = Object.entries(tools).map(([toolName, definition]) => {
    if (!isRecord(definition) || typeof definition.execute !== "function") return [toolName, definition] as const;

    const originalExecute = definition.execute as (...args: unknown[]) => unknown;
    const wrappedDefinition = {
      ...definition,
      execute: async (...args: unknown[]) => {
        const result = await originalExecute(...args);
        const compacted = compactToolOutputForModel(result);
        totalOutputChars += estimateToolPayloadChars(compacted);
        if (totalOutputChars <= budget) return compacted;

        return {
          warning: "Tool output truncated due to per-request context budget.",
          tool: toolName,
          preview:
            typeof compacted === "string"
              ? compacted.slice(0, MAX_TOOL_BUDGET_FALLBACK_STRING)
              : compactToolOutputForModel(compacted, MAX_TOOL_OUTPUT_DEPTH - 2),
        };
      },
    };
    return [toolName, wrappedDefinition] as const;
  });

  return Object.fromEntries(compactedEntries);
}

type ToolCallRow = { toolName: string | null; toolCallId: string | null };
type ToolResultRow = { toolCallId: string | null; output: unknown };

function looksMetadataLikeToolName(toolName: string | null): boolean {
  if (!toolName) return false;
  return METADATA_TOOL_PATTERNS.some((pattern) => pattern.test(toolName));
}

function containsNumericValue(value: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (typeof value === "number" && Number.isFinite(value)) return true;
  if (Array.isArray(value)) return value.some((item) => containsNumericValue(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.values(value).some((entry) => containsNumericValue(entry, depth + 1));
}

function extractToolActivity(resultLike: unknown): { calls: ToolCallRow[]; results: ToolResultRow[] } {
  const calls: ToolCallRow[] = [];
  const results: ToolResultRow[] = [];

  const source = isRecord(resultLike) ? resultLike : {};
  const topCalls = Array.isArray(source.toolCalls) ? source.toolCalls : [];
  const topResults = Array.isArray(source.toolResults) ? source.toolResults : [];
  const steps = Array.isArray(source.steps) ? source.steps : [];

  const ingestCall = (call: unknown) => {
    if (!isRecord(call)) return;
    calls.push({
      toolName: typeof call.toolName === "string" ? call.toolName : null,
      toolCallId: typeof call.toolCallId === "string" ? call.toolCallId : null,
    });
  };
  const ingestResult = (result: unknown) => {
    if (!isRecord(result)) return;
    results.push({
      toolCallId: typeof result.toolCallId === "string" ? result.toolCallId : null,
      output: result.output,
    });
  };

  topCalls.forEach(ingestCall);
  topResults.forEach(ingestResult);
  for (const step of steps) {
    if (!isRecord(step)) continue;
    const stepCalls = Array.isArray(step.toolCalls) ? step.toolCalls : [];
    const stepResults = Array.isArray(step.toolResults) ? step.toolResults : [];
    stepCalls.forEach(ingestCall);
    stepResults.forEach(ingestResult);
  }

  return { calls, results };
}

export type QuantEvidenceSummary = {
  toolCallCount: number;
  nonChartToolCallCount: number;
  createChartCallCount: number;
  firstToolName: string | null;
  firstToolMetadataLike: boolean;
  dataBearingResultCount: number;
  hasEnoughEvidence: boolean;
};

export function summarizeQuantEvidence(resultLike: unknown, minNonChartCalls: number): QuantEvidenceSummary {
  const { calls, results } = extractToolActivity(resultLike);
  const firstToolName = calls[0]?.toolName ?? null;
  const nonChartToolCallCount = calls.filter((call) => call.toolName && call.toolName !== CREATE_CHART_TOOL_NAME).length;
  const createChartCallCount = calls.filter((call) => call.toolName === CREATE_CHART_TOOL_NAME).length;
  const dataBearingResultCount = results.filter((row) => containsNumericValue(row.output)).length;
  const hasEnoughEvidence = nonChartToolCallCount >= minNonChartCalls && dataBearingResultCount > 0;

  return {
    toolCallCount: calls.length,
    nonChartToolCallCount,
    createChartCallCount,
    firstToolName,
    firstToolMetadataLike: looksMetadataLikeToolName(firstToolName),
    dataBearingResultCount,
    hasEnoughEvidence,
  };
}

