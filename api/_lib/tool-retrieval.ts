// Embedding-based tool retrieval. Pairs a precomputed catalog of tool
// embeddings (api/_lib/data/tool-embeddings.json, generated offline by
// scripts/build-tool-embeddings.ts) with a per-request query embedding to
// rank tools by cosine similarity. The keyword/synonym scoring in
// buildToolCatalog is the fallback when embeddings can't be produced
// (network failure, missing API key, brand-new tool not yet in the JSON).

import embeddingsRaw from "./data/tool-embeddings.json" with { type: "json" };

export type ToolEmbedding = { name: string; embedding: number[] };
export type EmbeddingCatalog = {
  model: string;
  dimensions: number;
  generatedAt: string;
  tools: ToolEmbedding[];
};

const CATALOG = embeddingsRaw as EmbeddingCatalog;

// Lookup by name for O(1) retrieval during scoring.
const TOOL_VECTOR_INDEX = new Map<string, number[]>(
  CATALOG.tools.map((t) => [t.name, t.embedding]),
);

export function getEmbeddingForTool(toolName: string): number[] | undefined {
  return TOOL_VECTOR_INDEX.get(toolName);
}

export function hasToolEmbedding(toolName: string): boolean {
  return TOOL_VECTOR_INDEX.has(toolName);
}

export function getEmbeddingCatalogMeta(): Pick<EmbeddingCatalog, "model" | "dimensions" | "generatedAt"> & { count: number } {
  return {
    model: CATALOG.model,
    dimensions: CATALOG.dimensions,
    generatedAt: CATALOG.generatedAt,
    count: CATALOG.tools.length,
  };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Embed a single query string via OpenRouter's embedding endpoint. Returns
 * null on any failure so the caller can transparently fall back to the
 * keyword scorer. We deliberately don't throw — this is a best-effort
 * enhancement, not a hard dependency.
 */
export async function embedQuery(
  query: string,
  options: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    model?: string;
    timeoutMs?: number;
  } = {},
): Promise<number[] | null> {
  const apiKey = options.apiKey;
  if (!apiKey) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? CATALOG.model;
  const timeoutMs = options.timeoutMs ?? 4000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetchImpl("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: query.slice(0, 4000) }),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { data?: Array<{ embedding: number[] }> };
    return json.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Rank tool names by cosine similarity to the query embedding. Tools without
 * a precomputed embedding (brand-new, not yet in the JSON) get a neutral
 * score of 0; the caller's downstream scorer can still surface them via
 * keyword match. Returns scores in the same order as the input names.
 */
export function rankToolsByEmbedding(
  toolNames: string[],
  queryEmbedding: number[],
): Array<{ name: string; score: number }> {
  const scores = toolNames.map((name) => {
    const vec = TOOL_VECTOR_INDEX.get(name);
    if (!vec) return { name, score: 0 };
    return { name, score: cosineSimilarity(queryEmbedding, vec) };
  });
  return scores.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * Score map suitable for blending with the keyword scorer. Returns a
 * `Map<toolName, similarity>` where similarity is in [-1, 1].
 */
export function buildEmbeddingScoreMap(
  toolNames: string[],
  queryEmbedding: number[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const name of toolNames) {
    const vec = TOOL_VECTOR_INDEX.get(name);
    if (vec) out.set(name, cosineSimilarity(queryEmbedding, vec));
  }
  return out;
}
