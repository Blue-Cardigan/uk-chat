import { createMCPClient } from "@ai-sdk/mcp";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, jsonSchema, stepCountIs } from "ai";
import { CHAT_MODEL_CONFIGS } from "../src/shared/chat-models.ts";
import { getSystemPrompt } from "../api/_lib/system-prompt.ts";

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
const REQUEST_TIMEOUT_MS = 60_000;

function fallbackModelsFor(modelId) {
  if (modelId === "flash") return ["google/gemini-2.5-flash-lite", "google/gemini-2.5-flash"];
  if (modelId === "pro") return ["google/gemini-2.5-pro", "google/gemini-2.5-flash"];
  return [];
}

function pickTools(tools, promptId) {
  const baseTools = [
    "postcodes_lookup",
    "geo_convertCode",
    "ons_fetchObservations",
    "desnz_energy",
    "police_fetchCrimes",
    "sources_describe",
  ];
  const preferred = promptId === "energy_comparison" ? ["desnz_energy"] : ["police_fetchCrimes", "postcodes_lookup"];
  const selectedNames = [...new Set([...preferred, ...baseTools])];
  const selectedEntries = Object.entries(tools).filter(([name]) => selectedNames.includes(name));
  const selected = Object.fromEntries(selectedEntries);
  selected.create_chart = {
    description: "Create a chart specification from one or more tool outputs.",
    inputSchema: jsonSchema(CREATE_CHART_INPUT_SCHEMA),
    execute: async (input) => input,
  };
  return selected;
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

    for (const model of CHAT_MODEL_CONFIGS) {
      for (const prompt of prompts) {
        console.log(`[matrix] model=${model.id} prompt=${prompt.id} starting...`);
        const startedAt = Date.now();
        const system = getSystemPrompt(new Date(), model.id);
        const tools = pickTools(mcpTools, prompt.id);
        try {
          const fallbackModels = fallbackModelsFor(model.id);
          const result = await withTimeout(
            generateText({
            model: openrouter.chat(model.providerModel, {
              extraBody: fallbackModels.length > 0 ? { models: fallbackModels } : undefined,
            }),
            system,
            prompt: prompt.text,
            tools,
            stopWhen: stepCountIs(10),
            }),
            REQUEST_TIMEOUT_MS,
            `${model.id}/${prompt.id}`,
          );
          const toolCalls = flattenToolCalls(result);
          const toolNames = toolCalls
            .map((call) => call?.toolName)
            .filter((name) => typeof name === "string");
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

    console.log(JSON.stringify({ ranAt: new Date().toISOString(), output }, null, 2));
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
