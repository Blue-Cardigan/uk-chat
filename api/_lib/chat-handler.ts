import { generateText, type LanguageModel } from "ai";
import { isRecord } from "./internals.js";

type PlanStep = {
  tool: string;
  objective: string;
};

function parsePlanSteps(raw: string): PlanStep[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        if (!isRecord(row)) return null;
        const tool = typeof row.tool === "string" ? row.tool.trim() : "";
        const objective = typeof row.objective === "string" ? row.objective.trim() : "";
        if (!tool || !objective) return null;
        return { tool, objective };
      })
      .filter((row): row is PlanStep => row !== null)
      .slice(0, 5);
  } catch {
    return [];
  }
}

export function buildExecutionPlanContext(planSteps: PlanStep[]): string {
  if (planSteps.length === 0) return "";
  const list = planSteps.map((step, index) => `${index + 1}. ${step.tool} - ${step.objective}`).join("\n");
  return [
    "EXECUTION PLAN (generated for this turn)",
    "Follow this plan unless a tool response proves a step is impossible.",
    list,
  ].join("\n");
}

export function buildQuantContinuationContext(params: {
  minNonChartCalls: number;
  firstToolMetadataLike: boolean;
  forceNoChartFirst: boolean;
}): string {
  const guidance = [
    "QUANTITATIVE CONTINUATION REQUIREMENTS",
    `- Before finalising, complete at least ${params.minNonChartCalls} non-create_chart data tool call(s).`,
    "- Fetch concrete observation/table rows with numeric values, not only search/list metadata.",
    params.firstToolMetadataLike
      ? "- Your first pass was metadata-like. Next call must fetch concrete data rows."
      : "- Ensure the next call enriches evidence with concrete numeric rows.",
    params.forceNoChartFirst
      ? "- Do not call create_chart until after non-create_chart data retrieval succeeds."
      : "- Only call create_chart after evidence retrieval is complete.",
  ];
  return guidance.join("\n");
}

export async function generateExecutionPlan(params: {
  model: LanguageModel;
  query: string;
  availableTools: string[];
  maxSteps?: number;
}): Promise<PlanStep[]> {
  const maxSteps = params.maxSteps ?? 4;
  if (!params.query.trim() || params.availableTools.length === 0) return [];

  const prompt = [
    "You are planning tool calls for a UK data assistant.",
    "Return ONLY valid JSON array, no prose.",
    `Generate up to ${maxSteps} steps.`,
    "Each step must be: {\"tool\":\"<tool_name>\",\"objective\":\"<why this call matters>\"}.",
    "Only choose tools from this allow-list:",
    params.availableTools.join(", "),
    "",
    `User query: ${params.query}`,
  ].join("\n");

  try {
    const result = await generateText({
      model: params.model,
      temperature: 0,
      maxOutputTokens: 220,
      prompt,
    });
    return parsePlanSteps(result.text);
  } catch {
    return [];
  }
}

