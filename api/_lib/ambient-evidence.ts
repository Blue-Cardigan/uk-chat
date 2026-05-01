// Speculative pre-execution of high-confidence tool calls.
//
// Built on top of the ambient-context layer. Once entities are detected
// (postcodes, MPs, LADs, dates), this module decides whether the user's
// intent is unambiguous enough to short-circuit the model's own tool-call
// loop by running the obvious tool ourselves — *before* the LLM stream
// even starts — and stuffing the result into the system prompt.
//
// The literature calls this "speculative actions" (arxiv 2510.04371). The
// classical formulation uses a small predictor model to forecast the next
// tool call and validates against the main model's eventual choice. Our
// agent space is small enough (≤4 high-confidence query patterns) that a
// deterministic rule list with no validation step beats a learned predictor
// on cost and latency: rules either match or they don't, and a non-match
// just means the LLM picks its own tools as usual.
//
// The aggressive choice is to inject the result as a system-prompt block
// rather than as a synthetic prior tool-result message. That keeps weak
// models from re-issuing the call (they see "the data is already here") and
// avoids fabricating tool-call IDs that downstream telemetry would have to
// stitch together. Strong models still issue follow-up calls as normal when
// they need more detail.

import type { AmbientContext } from "./ambient-context.js";

const MAX_EVIDENCE_PAYLOAD_CHARS = 4_000;

export type EvidenceItem = {
  rule: string;
  toolName: string;
  input: Record<string, unknown>;
  resultPreview: string; // already trimmed to MAX_EVIDENCE_PAYLOAD_CHARS
};

type ToolDefinition = {
  execute?: (input: unknown) => Promise<unknown> | unknown;
};

type EvidenceRule = {
  name: string;
  matches: (query: string, ambient: AmbientContext) => boolean;
  toolName: string;
  buildInput: (query: string, ambient: AmbientContext) => Record<string, unknown> | null;
  /** Optional post-processor — return a small string preview of the result. */
  summarize?: (raw: unknown) => string;
};

function tryParseToolText(raw: unknown): unknown {
  // MCP tool results frequently arrive as `{ content: [{ type: "text", text: "<json>" }] }`.
  // Unwrap to the inner JSON if possible, otherwise return as-is.
  if (raw && typeof raw === "object" && "content" in raw) {
    const content = (raw as { content?: unknown }).content;
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0];
      if (first && typeof first === "object" && "text" in first) {
        const text = (first as { text?: unknown }).text;
        if (typeof text === "string") {
          try {
            return JSON.parse(text);
          } catch {
            return text;
          }
        }
      }
    }
  }
  return raw;
}

function compactJson(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== "string") return String(value);
    return json.length > MAX_EVIDENCE_PAYLOAD_CHARS
      ? `${json.slice(0, MAX_EVIDENCE_PAYLOAD_CHARS)}…[truncated]`
      : json;
  } catch {
    return String(value).slice(0, MAX_EVIDENCE_PAYLOAD_CHARS);
  }
}

function aggregatePoliceCrimesByCategory(raw: unknown): string {
  const unwrapped = tryParseToolText(raw);
  // The police adapter returns either { ok, payload: [crimes...] } or a truncation envelope.
  // Try a few shapes.
  const payload =
    isRecord(unwrapped) && Array.isArray((unwrapped as { payload?: unknown }).payload)
      ? ((unwrapped as { payload: unknown[] }).payload)
      : Array.isArray(unwrapped)
        ? unwrapped
        : null;
  if (!payload) {
    // Truncation envelope etc — fall back to compactJson preview
    return compactJson(unwrapped);
  }
  const counts = new Map<string, number>();
  for (const row of payload) {
    if (!isRecord(row)) continue;
    const cat = typeof row.category === "string" ? row.category : "unknown";
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = payload.length;
  const summary = sorted.map(([cat, n]) => `${cat}=${n}`).join(", ");
  return JSON.stringify({
    total_crimes: total,
    by_category: sorted.map(([category, count]) => ({ category, count })),
    summary_text: `${total} crimes; ${summary}`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const RULES: EvidenceRule[] = [
  {
    name: "crime + postcode → police_fetchCrimes",
    toolName: "police_fetchCrimes",
    matches: (query, ambient) =>
      /\b(crime|police|safety|offen[cs]e|arson|burglary|robbery|theft|anti-?social)\b/i.test(query) &&
      ambient.postcodes.length > 0,
    buildInput: (_query, ambient) => {
      const first = ambient.postcodes[0];
      if (!first) return null;
      return { postcode: first.postcode, kind: "crimes_at_location", limit: 1500 };
    },
    summarize: aggregatePoliceCrimesByCategory,
  },
  {
    name: "MP voting record → parliament_votes",
    toolName: "parliament_votes",
    matches: (query, ambient) => {
      if (!/\b(vot(e|ed|ing)|division|aye|nay|abstain)\b/i.test(query)) return false;
      const hasMember = ambient.constituencies.length > 0 || ambient.mpsByName.length > 0;
      return hasMember;
    },
    buildInput: (_query, ambient) => {
      const member = ambient.constituencies[0] ?? ambient.mpsByName[0];
      if (!member) return null;
      return {
        kind: "mp_voting_record",
        memberId: member.memberId,
        take: 10,
        skip: 0,
      };
    },
    summarize: (raw) => compactJson(tryParseToolText(raw)),
  },
];

export async function runAmbientEvidence(
  query: string | null | undefined,
  ambient: AmbientContext,
  tools: Record<string, unknown>,
): Promise<EvidenceItem[]> {
  if (!query) return [];
  const items: EvidenceItem[] = [];
  await Promise.all(
    RULES.map(async (rule) => {
      if (!rule.matches(query, ambient)) return;
      const tool = tools[rule.toolName] as ToolDefinition | undefined;
      if (!tool || typeof tool.execute !== "function") return;
      const input = rule.buildInput(query, ambient);
      if (!input) return;
      try {
        const raw = await tool.execute(input);
        const preview = rule.summarize ? rule.summarize(raw) : compactJson(raw);
        items.push({
          rule: rule.name,
          toolName: rule.toolName,
          input,
          resultPreview: preview.length > MAX_EVIDENCE_PAYLOAD_CHARS
            ? `${preview.slice(0, MAX_EVIDENCE_PAYLOAD_CHARS)}…[truncated]`
            : preview,
        });
      } catch {
        // Speculative — silent failure is fine; the model still has its own tools.
      }
    }),
  );
  return items;
}

export function renderAmbientEvidenceBlock(items: readonly EvidenceItem[]): string {
  if (items.length === 0) return "";
  const lines: string[] = [
    "AMBIENT EVIDENCE — high-confidence tool results were pre-fetched based on the user's query. The data below is REAL data already retrieved from the named tools. Use it directly to answer or to seed a chart; do NOT call the same tool with the same arguments again unless you need additional rows or a different parameterisation.",
  ];
  for (const item of items) {
    lines.push("");
    lines.push(`## ${item.toolName}(${JSON.stringify(item.input)})`);
    lines.push(`Source rule: ${item.rule}`);
    lines.push("");
    lines.push("```json");
    lines.push(item.resultPreview);
    lines.push("```");
  }
  return lines.join("\n");
}
