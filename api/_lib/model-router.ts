// Pre-classifier that maps incoming chat requests to the right model when
// the user accepts the default. Honours explicit picks unchanged.
//
// Heuristic-only (no LLM call): combines the existing query primitives
// (`shouldRequireDataToolCall`, `hasChartIntent`, `hasPriorNonChartToolOutput`)
// with entity counts from the ambient context and a simple length signal.
// Three tiers map onto the model lineup we already operate:
//   - simple lookup            → flash
//   - moderate / single-chart  → sonnet
//   - heavy / multi-step       → opus
//
// Pro is intentionally never auto-routed: it has the strict schema-complexity
// quirk we worked around earlier, and it's the most expensive model. Users
// who want it pick it explicitly.

import type { ChatModelId } from "../../src/shared/chat-models.js";
import type { AmbientContext } from "./ambient-context.js";
import { detectUkPostcodes } from "./ambient-context.js";
import { hasChartIntent, hasPriorNonChartToolOutput, shouldRequireDataToolCall } from "./tool-pipeline.js";

export type RouteDecision = {
  modelId: ChatModelId;
  reason: string;
  signals: {
    requiresDataTool: boolean;
    chartIntent: boolean;
    priorToolOutput: boolean;
    promptWordCount: number;
    entityCount: number;
    multipleChartsRequested: boolean;
    comparisonRequested: boolean;
  };
};

const MULTI_CHART_PATTERN = /\b(two charts|three charts|several charts|multi[- ]chart|side by side|alongside)\b/i;
const COMPARISON_PATTERN = /\b(compare|vs\.?|versus|against|relative to|both|across)\b/i;

function countEntities(ambient: AmbientContext): number {
  return (
    ambient.postcodes.length +
    ambient.constituencies.length +
    ambient.mpsByName.length +
    ambient.lads.length +
    ambient.places.length
  );
}

/**
 * Fast entity count from the query string alone — used at request entry
 * before the full async ambient context build runs. Counts postcodes
 * deterministically; under-counts other entity types but that's the safe
 * direction (we'd rather pick a slightly weaker model than route a simple
 * lookup to opus on a false positive).
 */
function countQueryEntitiesFastPath(query: string): number {
  return detectUkPostcodes(query).length;
}

export function routeModel(params: {
  query: string;
  ambient?: AmbientContext;
  messages: Array<{ role?: string; parts?: unknown[] }> | undefined;
}): RouteDecision {
  const { query, ambient, messages } = params;
  const requiresDataTool = shouldRequireDataToolCall(query);
  const chartIntent = hasChartIntent(query);
  const priorToolOutput = hasPriorNonChartToolOutput(messages);
  const promptWordCount = query.trim().split(/\s+/).filter(Boolean).length;
  const entityCount = ambient ? countEntities(ambient) : countQueryEntitiesFastPath(query);
  const multipleChartsRequested = MULTI_CHART_PATTERN.test(query);
  const comparisonRequested = COMPARISON_PATTERN.test(query);

  const signals = {
    requiresDataTool,
    chartIntent,
    priorToolOutput,
    promptWordCount,
    entityCount,
    multipleChartsRequested,
    comparisonRequested,
  };

  // Heavy: multi-chart, multi-entity comparison, very long, or explicitly
  // multi-step quantitative work.
  if (
    multipleChartsRequested ||
    (comparisonRequested && entityCount >= 2) ||
    promptWordCount > 60 ||
    (chartIntent && entityCount >= 2)
  ) {
    return {
      modelId: "opus",
      reason: multipleChartsRequested
        ? "explicit multi-chart request"
        : comparisonRequested && entityCount >= 2
          ? "comparison across ≥2 entities"
          : promptWordCount > 60
            ? "long prompt (>60 words)"
            : "chart + ≥2 entities",
      signals,
    };
  }

  // Moderate: chart-explicit OR quantitative with at least one entity.
  if (chartIntent || (requiresDataTool && entityCount >= 1)) {
    return {
      modelId: "sonnet",
      reason: chartIntent ? "chart-explicit prompt" : "quantitative with entity",
      signals,
    };
  }

  // Otherwise: simple lookup, conversational follow-up, or vague question.
  return {
    modelId: "flash",
    reason: "simple lookup / follow-up",
    signals,
  };
}
