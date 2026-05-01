// Golden prompts for the chatgb eval harness.
//
// Each entry pairs a representative user prompt with a set of assertions
// that must hold against the live response. Assertions are intentionally
// permissive — we don't pin the assistant's exact wording, only that
// substantive things happened (right tool fired, chart artifact present,
// key numeric facts surfaced).
//
// Add an entry whenever a new feature lands or a regression is fixed:
// the harness is the contract that locks in current behaviour against
// future drift.

export type GoldenAssertion =
  | { kind: "tool_called"; toolName: string }
  | { kind: "tool_not_called"; toolName: string }
  | { kind: "chart_rendered" }
  | { kind: "text_contains"; needle: string; caseInsensitive?: boolean }
  | { kind: "text_matches"; pattern: string }
  | { kind: "no_synthesized_error" }
  | { kind: "min_tool_calls"; count: number }
  | { kind: "max_tool_calls"; count: number };

export type GoldenPrompt = {
  id: string;
  prompt: string;
  modelId?: string; // omit for auto-route
  description: string;
  assertions: GoldenAssertion[];
  category: "lookup" | "chart" | "comparison" | "voting" | "trend" | "ambient";
  // Skip on ephemeral conditions (rate limit, upstream flake, etc.).
  // The eval driver retries `flaky: true` cases up to 2x before failing.
  flaky?: boolean;
};

export const GOLDEN_PROMPTS: readonly GoldenPrompt[] = [
  {
    id: "crime-postcode-bar",
    prompt: "Show recent crime within 1 mile of SE1 1AA broken down by category as a bar chart.",
    modelId: "opus",
    description: "Chart-explicit prompt with postcode entity. Should fire police_fetchCrimes via ambient evidence and render a bar chart.",
    category: "chart",
    assertions: [
      { kind: "tool_called", toolName: "police_fetchCrimes" },
      { kind: "tool_called", toolName: "create_chart" },
      { kind: "chart_rendered" },
      { kind: "no_synthesized_error" },
      { kind: "text_contains", needle: "data.police.uk", caseInsensitive: true },
    ],
  },
  {
    id: "crime-place-bar",
    prompt: "How safe is my area? Show crime data for Finsbury Park as a bar chart.",
    modelId: "flash",
    description: "Chart prompt with a free-text place name (no postcode). Should geocode via Nominatim, fire police_fetchCrimes with lat/lng, and chart.",
    category: "ambient",
    assertions: [
      { kind: "chart_rendered" },
      { kind: "no_synthesized_error" },
      { kind: "text_contains", needle: "Finsbury Park", caseInsensitive: true },
    ],
  },
  {
    id: "mp-voting-record",
    prompt: "What has Keir Starmer voted on recently? Show his last 5 voting records.",
    modelId: "flash",
    description: "MP entity should be detected by ambient context, parliament_votes pre-fired by ambient evidence. No need for additional tool calls.",
    category: "voting",
    assertions: [
      { kind: "text_contains", needle: "Keir Starmer", caseInsensitive: true },
      { kind: "text_matches", pattern: "(Aye|Yes|No|Nay|Abstain)" },
      { kind: "max_tool_calls", count: 2 },
    ],
  },
  {
    id: "constituency-demographics",
    prompt: "What's the demographic makeup of Bristol Central?",
    modelId: "sonnet",
    description: "Constituency lookup. Ambient context resolves Bristol Central → MP + memberId. Model should fetch demographic data.",
    category: "lookup",
    assertions: [
      { kind: "text_contains", needle: "Bristol Central", caseInsensitive: true },
      { kind: "min_tool_calls", count: 1 },
    ],
  },
  {
    id: "multi-chart-trend-breakdown",
    prompt: "For Bristol Central: (1) show the trend of total recorded crime over the past 6 months as a line chart, and (2) break down the most recent month by category as a bar chart. Two charts please.",
    modelId: "opus",
    description: "Hard multi-chart prompt. Requires time_series + chart from byMonth + chart from byCategory aggregates. Strong test of data-handle pattern + adapter pre-aggregation.",
    category: "trend",
    assertions: [
      { kind: "tool_called", toolName: "police_fetchCrimes" },
      { kind: "tool_called", toolName: "create_chart" },
      { kind: "chart_rendered" },
      { kind: "no_synthesized_error" },
    ],
    flaky: true, // 8k+ rows; sometimes upstream police API has transient 502s
  },
  {
    id: "flood-warnings-place",
    prompt: "Are there any flood warnings near Manchester right now?",
    modelId: "flash",
    description: "Place name + ea_flood. Should geocode Manchester and fetch warnings.",
    category: "lookup",
    assertions: [
      { kind: "text_contains", needle: "Manchester", caseInsensitive: true },
      { kind: "min_tool_calls", count: 1 },
    ],
    flaky: true,
  },
  {
    id: "pure-lookup-postcode",
    prompt: "What constituency is SW1A 1AA in?",
    modelId: "flash",
    description: "Pure lookup, no chart. Ambient context already resolves SW1A 1AA → constituency. Model should answer from context with at most 1 tool call.",
    category: "lookup",
    assertions: [
      { kind: "text_matches", pattern: "(Cities of London|Westminster)" },
      { kind: "max_tool_calls", count: 1 },
    ],
  },
];

export function findGoldenPrompt(id: string): GoldenPrompt | null {
  return GOLDEN_PROMPTS.find((p) => p.id === id) ?? null;
}
