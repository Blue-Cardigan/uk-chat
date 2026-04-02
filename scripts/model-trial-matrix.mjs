import { createMCPClient } from "@ai-sdk/mcp";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, jsonSchema, stepCountIs } from "ai";
import { CHAT_MODEL_CONFIGS } from "../src/shared/chat-models.ts";
import { getSystemPrompt } from "../api/_lib/system-prompt.ts";
import { enforceCreateChartDataPrereq } from "../api/_lib/tool-pipeline.ts";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "https://mcp.explorethekingdom.co.uk/sse";
const MCP_TOKEN = process.env.MCP_TOKEN;

if (!OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is required");
}
if (!MCP_TOKEN) {
  throw new Error("MCP_TOKEN is required");
}

const openrouter = createOpenRouter({ apiKey: OPENROUTER_API_KEY });

const CREATE_CHART_INPUT_SCHEMA = {
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
      items: { type: "object", additionalProperties: true },
    },
    sources: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
};

const prompts = [
  {
    id: "energy_comparison",
    text: "Compare London borough energy use for the latest year and show a chart. Keep to 8 boroughs max.",
  },
  {
    id: "crime_trend",
    text: "What changed in crime around SE1 1AA over the last 12 months? Use monthly trend and include one concise caveat.",
  },
];

const TOOLS_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 90_000;
const METADATA_TOOL_PATTERNS = [/(^|[_.-])(search|list|describe|catalog|datasets|layers)([_.-]|$)/i, /(^|[_.-])lookup([_.-]|$)/i];
const MODEL_FILTER = (process.env.MATRIX_MODEL_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function fallbackModelsFor(modelId) {
  if (modelId === "flash") return ["google/gemini-2.5-flash-lite", "google/gemini-2.5-flash"];
  if (modelId === "pro") return ["google/gemini-2.5-pro", "google/gemini-2.5-flash"];
  return [];
}

function pickTools(tools, promptId) {
  const baseTools = [
    "postcodes.lookup",
    "geo.convertCode",
    "ons.fetchObservations",
    "desnz.energy",
    "desnz.fetchEnergy",
    "police.fetchCrimes",
    "sources.describe",
    "nomis.fetchTable",
  ];
  const preferred =
    promptId === "energy_comparison"
      ? ["desnz.fetchEnergy", "desnz.energy", "nomis.fetchTable"]
      : ["postcodes.lookup", "police.fetchCrimes"];
  const selectedNames = [...new Set([...preferred, ...baseTools])];
  const selectedEntries = Object.entries(tools).filter(([name]) => selectedNames.includes(name));
  const selected = Object.fromEntries(selectedEntries);
  selected.create_chart = {
    description: "Create a chart specification from one or more tool outputs.",
    inputSchema: jsonSchema(CREATE_CHART_INPUT_SCHEMA),
    execute: async (input) => input,
  };
  return enforceCreateChartDataPrereq(selected);
}

function withoutCreateChart(tools) {
  return Object.fromEntries(Object.entries(tools).filter(([name]) => name !== "create_chart"));
}

function toProviderSafeName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function toProviderSafeTools(tools) {
  const safeEntries = Object.entries(tools).map(([name, definition]) => [toProviderSafeName(name), definition]);
  return Object.fromEntries(safeEntries);
}

function flattenToolCalls(result) {
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  const calls = [];
  for (const step of steps) {
    if (Array.isArray(step?.toolCalls)) {
      for (const call of step.toolCalls) calls.push(call);
    }
  }
  return calls;
}

function flattenToolResults(result) {
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  const outputs = [];
  for (const step of steps) {
    if (Array.isArray(step?.toolResults)) {
      for (const row of step.toolResults) outputs.push(row);
    }
  }
  return outputs;
}

function isMetadataLikeTool(toolName) {
  if (typeof toolName !== "string") return false;
  return METADATA_TOOL_PATTERNS.some((pattern) => pattern.test(toolName));
}

function hasNumericValue(value, depth = 0) {
  if (depth > 4) return false;
  if (typeof value === "number" && Number.isFinite(value)) return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (/^-?\d+(\.\d+)?$/.test(trimmed.replace(/,/g, ""))) return true;
  }
  if (Array.isArray(value)) return value.some((item) => hasNumericValue(item, depth + 1));
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((entry) => hasNumericValue(entry, depth + 1));
}

async function run() {
  const withTimeout = (promise, timeoutMs, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);

  console.log("[matrix] connecting MCP client...");
  const client = await createMCPClient({
    transport: {
      type: "sse",
      url: MCP_SERVER_URL,
      headers: {
        Authorization: `Bearer ${MCP_TOKEN}`,
      },
    },
  });

  try {
    const mcpTools = await withTimeout(client.tools(), TOOLS_TIMEOUT_MS, "MCP tools load");
    console.log(`[matrix] loaded tools: ${Object.keys(mcpTools).length}`);
    const output = [];

    const modelsToRun =
      MODEL_FILTER.length === 0 ? CHAT_MODEL_CONFIGS : CHAT_MODEL_CONFIGS.filter((model) => MODEL_FILTER.includes(model.id));
    for (const model of modelsToRun) {
      for (const prompt of prompts) {
        console.log(`[matrix] model=${model.id} prompt=${prompt.id} starting...`);
        const startedAt = Date.now();
        const system = getSystemPrompt(new Date(), model.id);
        const tools = toProviderSafeTools(pickTools(mcpTools, prompt.id));
        const prefetchTools = withoutCreateChart(tools);
        try {
          const fallbackModels = fallbackModelsFor(model.id);
          const prefetch = await withTimeout(
            generateText({
              model: openrouter.chat(model.providerModel, {
                extraBody: fallbackModels.length > 0 ? { models: fallbackModels } : undefined,
              }),
              system,
              prompt: [
                "Run tool calls to gather concrete numeric evidence for this quantitative query.",
                "Do not finalise an answer yet.",
                "Do not call create_chart in this prefetch step.",
                "Make at most 2 tool calls in this prefetch step.",
                "",
                `User query: ${prompt.text}`,
              ].join("\n"),
              tools: prefetchTools,
              toolChoice: "required",
              stopWhen: stepCountIs(2),
              temperature: 0,
            }),
            REQUEST_TIMEOUT_MS,
            `${model.id}/${prompt.id}/prefetch`,
          );
          const result = await withTimeout(
            generateText({
              model: openrouter.chat(model.providerModel, {
                extraBody: fallbackModels.length > 0 ? { models: fallbackModels } : undefined,
              }),
              system,
              prompt: prompt.text,
              tools,
              toolChoice: "required",
              stopWhen: stepCountIs(6),
            }),
            REQUEST_TIMEOUT_MS,
            `${model.id}/${prompt.id}/main`,
          );
          const toolCalls = [...flattenToolCalls(prefetch), ...flattenToolCalls(result)];
          const toolResults = [...flattenToolResults(prefetch), ...flattenToolResults(result)];
          const toolNames = toolCalls
            .map((call) => call?.toolName)
            .filter((name) => typeof name === "string");
          const firstToolName = toolNames[0] ?? null;
          const nonChartToolCallCount = toolNames.filter((name) => name !== "create_chart").length;
          const metadataLikeFirstTool = isMetadataLikeTool(firstToolName);
          const dataBearingResultCount = toolResults.filter((row) => hasNumericValue(row?.output)).length;
          const minRequired = typeof model.minDataToolCallsForQuant === "number" ? model.minDataToolCallsForQuant : 1;
          const evidenceSufficient = nonChartToolCallCount >= minRequired && dataBearingResultCount > 0;
          output.push({
            modelId: model.id,
            modelLabel: model.label,
            providerModel: model.providerModel,
            promptId: prompt.id,
            ok: true,
            latencyMs: Date.now() - startedAt,
            textChars: result.text?.length ?? 0,
            toolCallCount: toolNames.length,
            toolNames,
            firstToolName,
            metadataLikeFirstTool,
            nonChartToolCallCount,
            dataBearingResultCount,
            minNonChartCallsRequired: minRequired,
            evidenceSufficient,
            createChartCalled: toolNames.includes("create_chart"),
          });
          console.log(`[matrix] model=${model.id} prompt=${prompt.id} ok toolCalls=${toolNames.length}`);
        } catch (error) {
          output.push({
            modelId: model.id,
            modelLabel: model.label,
            providerModel: model.providerModel,
            promptId: prompt.id,
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          });
          console.log(`[matrix] model=${model.id} prompt=${prompt.id} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    const acceptance = {
      gptEnergyHasAtLeastTwoCalls: output.some(
        (row) => row.modelId === "gpt" && row.promptId === "energy_comparison" && row.toolCallCount >= 2,
      ),
      gptEnergyHasNonChartEvidence: output.some(
        (row) =>
          row.modelId === "gpt" &&
          row.promptId === "energy_comparison" &&
          row.nonChartToolCallCount >= 1,
      ),
      gptCrimeHasPostcodeOrDataRetrieval: output.some(
        (row) =>
          row.modelId === "gpt" &&
          row.promptId === "crime_trend" &&
          Array.isArray(row.toolNames) &&
          row.toolNames.some(
            (name) =>
              name === "postcodes_lookup" ||
              name === "police_fetchCrimes" ||
              name === "postcodes.lookup" ||
              name === "police.fetchCrimes",
          ),
      ),
    };

    console.log(JSON.stringify({ ranAt: new Date().toISOString(), output, acceptance }, null, 2));
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
