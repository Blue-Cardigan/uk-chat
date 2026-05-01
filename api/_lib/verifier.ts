// Self-correction verifier pass.
//
// After the main streamText finishes for a chart-producing turn, we run a
// short prompt against a cheap model that compares the assistant's text
// against the chart spec(s) it produced and the underlying tool data. Catches
// the classic LLM failure: "the answer says Theft was highest" but the chart
// shows Anti-social. Returns a correction text we append as a follow-up
// system note on the assistant message — the user sees both the original
// answer and the correction, with the correction clearly labelled.
//
// Cost control: only fires on prompts that produced at least one chart, uses
// Gemini Flash Lite via OpenRouter, capped at 600 output tokens. Skipped
// entirely on Pro because Pro already triple-checks itself.

import { generateText } from "ai";
import type { OpenRouterProvider } from "@openrouter/ai-sdk-provider";
import type { ChatModelId } from "../../src/shared/chat-models.js";
import { isRecord } from "../../src/shared/type-guards.js";

const VERIFIER_PROVIDER_MODEL = "google/gemini-2.5-flash-lite";

export type VerifierResult =
  | { ok: true; reason: string | null }
  | { ok: false; reason: string; correction: string };

type ChartSummary = {
  title: string | null;
  type: string | null;
  topRow: { label: string; value: number } | null;
  rowCount: number;
};

type ToolSummary = {
  toolName: string;
  preview: string;
};

// Exported for tests; production callers should use runVerifierPass.
export function summariseChartPart(part: Record<string, unknown>): ChartSummary | null {
  const output = part.output;
  if (!isRecord(output)) return null;
  const title = typeof output.title === "string" ? output.title : null;
  const type = typeof output.type === "string" ? output.type : null;
  const data = Array.isArray(output.data) ? (output.data as Array<Record<string, unknown>>) : [];
  if (data.length === 0) return { title, type, topRow: null, rowCount: 0 };
  // Find the row with the largest numeric value across the chart's yFields.
  const yFields = Array.isArray(output.yFields) ? (output.yFields as string[]) : ["value"];
  let bestRow: { label: string; value: number } | null = null;
  for (const row of data) {
    if (!isRecord(row)) continue;
    let val = -Infinity;
    for (const field of yFields) {
      const cell = row[field];
      if (typeof cell === "number" && cell > val) val = cell;
    }
    if (val === -Infinity) continue;
    const xField = typeof output.xField === "string" ? output.xField : Object.keys(row)[0];
    const label = String(row[xField] ?? "?");
    if (!bestRow || val > bestRow.value) bestRow = { label, value: val };
  }
  return { title, type, topRow: bestRow, rowCount: data.length };
}

function extractCharts(parts: ReadonlyArray<unknown>): ChartSummary[] {
  const out: ChartSummary[] = [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part.type !== "tool-create_chart") continue;
    if (part.state !== "output-available") continue;
    const summary = summariseChartPart(part);
    if (summary) out.push(summary);
  }
  return out;
}

function extractToolPreviews(parts: ReadonlyArray<unknown>, max = 3): ToolSummary[] {
  const out: ToolSummary[] = [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (typeof part.type !== "string" || !part.type.startsWith("tool-")) continue;
    if (part.type === "tool-create_chart") continue;
    if (part.state !== "output-available") continue;
    const toolName = part.type.slice("tool-".length);
    let preview: string;
    try {
      preview = JSON.stringify(part.output).slice(0, 800);
    } catch {
      preview = "[unserialisable]";
    }
    out.push({ toolName, preview });
    if (out.length >= max) break;
  }
  return out;
}

function extractAnswerText(parts: ReadonlyArray<unknown>): string {
  let text = "";
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") text += part.text;
  }
  return text.trim();
}

export async function runVerifierPass(params: {
  parts: ReadonlyArray<unknown>;
  modelId: ChatModelId;
  openrouter: OpenRouterProvider;
}): Promise<VerifierResult | null> {
  const { parts, modelId, openrouter } = params;
  // Skip for Pro: it already self-corrects.
  if (modelId === "pro") return null;
  const charts = extractCharts(parts);
  // Only fire when there's at least one chart; pure-text answers go through
  // the existing fallback paths.
  if (charts.length === 0) return null;
  const answerText = extractAnswerText(parts);
  if (answerText.length === 0) return null;
  const toolPreviews = extractToolPreviews(parts);
  if (toolPreviews.length === 0) return null;

  const prompt = [
    "You are a quick fact-check pass. Below is an assistant answer, the chart specs it produced, and the raw outputs from the data tools it called.",
    "Check ONLY for these specific errors:",
    "1) The answer cites a value or category as 'highest' / 'most' / 'top' that doesn't match the chart's actual top row.",
    "2) The answer cites a numeric value that isn't anywhere in the tool outputs.",
    "3) The answer claims something the data clearly contradicts.",
    "If everything is consistent, respond ONLY with: {\"ok\": true}",
    "If you find a problem, respond ONLY with: {\"ok\": false, \"reason\": \"<one sentence>\", \"correction\": \"<one or two sentences correcting the user-visible answer>\"}",
    "",
    "ASSISTANT ANSWER:",
    answerText.slice(0, 2000),
    "",
    "CHART SPECS:",
    JSON.stringify(charts.slice(0, 2)),
    "",
    "TOOL OUTPUTS (previews):",
    toolPreviews.map((t) => `${t.toolName}: ${t.preview}`).join("\n").slice(0, 1800),
  ].join("\n");

  try {
    const result = await generateText({
      model: openrouter.chat(VERIFIER_PROVIDER_MODEL),
      prompt,
      temperature: 0,
      maxOutputTokens: 600,
    });
    const text = result.text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ok: true, reason: null };
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    if (parsed.ok === true) return { ok: true, reason: null };
    if (parsed.ok === false && typeof parsed.reason === "string" && typeof parsed.correction === "string") {
      return { ok: false, reason: parsed.reason, correction: parsed.correction };
    }
    return { ok: true, reason: null };
  } catch {
    // Best-effort — verifier errors don't fail the user-visible response.
    return null;
  }
}
