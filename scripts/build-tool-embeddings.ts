// Offline build step: embed every MCP tool's name + description and write
// to api/_lib/data/tool-embeddings.json. The runtime tool-retrieval path
// reads this file and scores by cosine similarity between the user query
// and each tool's embedding. Run after a meaningful tool-catalog change:
//
//   pnpm exec tsx scripts/build-tool-embeddings.ts
//
// Requires OPENROUTER_API_KEY + an MCP token in .env (the script mints one
// itself via MCP_TOKEN_ISSUE_URL).

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createMCPClient } from "@ai-sdk/mcp";

const EMBEDDING_MODEL = "baai/bge-base-en-v1.5";
const OUTPUT_PATH = resolve(process.cwd(), "api/_lib/data/tool-embeddings.json");
const BATCH_SIZE = 16;

function loadEnvFromWorkspace() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function mintMcpToken(): Promise<string> {
  const issueUrl = process.env.MCP_TOKEN_ISSUE_URL ?? "https://mcp.explorethekingdom.co.uk/api/tokens";
  const issueSecret = process.env.MCP_TOKEN_ISSUE_SECRET;
  const email = process.env.EVAL_USER_EMAIL ?? "jethro.reeve@gmail.com";
  if (!issueSecret) throw new Error("MCP_TOKEN_ISSUE_SECRET not set in .env");
  const resp = await fetch(issueUrl, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${issueSecret}` },
    body: JSON.stringify({ email }),
  });
  if (!resp.ok) throw new Error(`MCP token mint failed: ${resp.status}`);
  const json = (await resp.json()) as { token?: string };
  if (!json.token) throw new Error("Token issuer returned no token");
  return json.token;
}

async function loadMcpToolCatalog(): Promise<Array<{ name: string; description: string }>> {
  const token = await mintMcpToken();
  const url = process.env.MCP_SERVER_URL ?? "https://mcp.explorethekingdom.co.uk/sse";
  const client = await createMCPClient({
    transport: { type: "sse", url, headers: { Authorization: `Bearer ${token}` } },
  });
  const tools = (await client.tools()) as Record<string, { description?: string }>;
  await (client as unknown as { close?: () => Promise<void> }).close?.();
  return Object.entries(tools).map(([name, def]) => ({
    name,
    description: typeof def.description === "string" ? def.description : "",
  }));
}

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set in .env");
  const resp = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Embedding request failed (${resp.status}): ${body.slice(0, 200)}`);
  }
  const json = (await resp.json()) as { data?: Array<{ embedding: number[] }> };
  const out = json.data?.map((d) => d.embedding) ?? [];
  if (out.length !== inputs.length) {
    throw new Error(`Expected ${inputs.length} embeddings, got ${out.length}`);
  }
  return out;
}

function roundEmbedding(vec: number[]): number[] {
  // 6 decimals halves the JSON size with no measurable accuracy impact for
  // cosine ranking.
  return vec.map((v) => Number(v.toFixed(6)));
}

async function main() {
  loadEnvFromWorkspace();
  console.log("Loading MCP tool catalog…");
  const tools = await loadMcpToolCatalog();
  console.log(`Found ${tools.length} tools.`);

  const inputs = tools.map((t) => `Tool: ${t.name}\nDescription: ${t.description}`.slice(0, 4000));
  const embeddings: number[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE);
    process.stdout.write(`  embed batch ${i}/${inputs.length}…\r`);
    const out = await embedBatch(batch);
    embeddings.push(...out);
  }
  console.log(`\nEmbedded ${embeddings.length} tools.`);

  const dimensions = embeddings[0]?.length ?? 0;
  const payload = {
    model: EMBEDDING_MODEL,
    dimensions,
    generatedAt: new Date().toISOString(),
    tools: tools.map((t, i) => ({ name: t.name, embedding: roundEmbedding(embeddings[i]) })),
  };
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(payload));
  const sizeKB = Math.round(JSON.stringify(payload).length / 1024);
  console.log(`Wrote ${OUTPUT_PATH} (${sizeKB} KB, ${dimensions} dimensions).`);
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
