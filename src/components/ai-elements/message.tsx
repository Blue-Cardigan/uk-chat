import { lazy, memo, Suspense, useMemo, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card } from "@/components/ui/primitives";
import { ArtifactToolbar } from "@/components/viz/ArtifactToolbar";
import { VizCompactContext } from "@/components/viz/VisualizationCard";
import { buildChartSpecFromVizHint, isChartSpec } from "@/lib/viz-data-parser";
import { isVizArtifactCandidate } from "@/lib/viz-helpers";
import type { ChartSpec, VizPayload } from "@/lib/types";
import { cn } from "@/lib/utils";
import { stripToolContextEchoes } from "@/shared/text-sanitize";

const VizRouter = lazy(() => import("@/components/viz/VizRouter").then((m) => ({ default: m.VizRouter })));
const DataDrivenChart = lazy(() =>
  import("@/components/viz/charts/DataDrivenChart").then((m) => ({ default: m.DataDrivenChart })),
);

type ChartSegment =
  | { kind: "text"; text: string }
  | { kind: "chart"; spec: ChartSpec };

function findBalancedJsonObject(text: string, fromIndex: number): { raw: string; endIndex: number } | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;
  for (let index = fromIndex; index < text.length; index += 1) {
    const char = text[index];
    if (start === -1) {
      if (char === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return { raw: text.slice(start, index + 1), endIndex: index + 1 };
      }
    }
  }
  return null;
}

function splitTextIntoChartSegments(text: string): ChartSegment[] {
  const segments: ChartSegment[] = [];
  let cursor = 0;
  let emittedChart = false;
  while (cursor < text.length) {
    const braceIndex = text.indexOf("{", cursor);
    if (braceIndex === -1) break;
    const match = findBalancedJsonObject(text, braceIndex);
    if (!match) break;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(match.raw);
    } catch {
      parsed = null;
    }
    if (isChartSpec(parsed)) {
      const before = text.slice(cursor, braceIndex);
      let leading = before;
      let trailingStart = match.endIndex;
      const fenceStart = before.lastIndexOf("```");
      if (fenceStart !== -1 && /^```(?:json)?\s*$/i.test(before.slice(fenceStart).trim())) {
        leading = before.slice(0, fenceStart);
        const closeFence = text.indexOf("```", match.endIndex);
        if (closeFence !== -1 && text.slice(match.endIndex, closeFence).trim().length === 0) {
          trailingStart = closeFence + 3;
        }
      }
      if (leading.length > 0) segments.push({ kind: "text", text: leading });
      segments.push({ kind: "chart", spec: parsed });
      emittedChart = true;
      cursor = trailingStart;
      continue;
    }
    cursor = braceIndex + 1;
  }
  if (!emittedChart) return [{ kind: "text", text }];
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}

/* ── Streaming format (AI SDK v6 UIMessage) ─────────────────────────── */
type ToolInvocationPart = {
  type: "tool-invocation";
  toolInvocation: {
    toolCallId: string;
    toolName: string;
    args: unknown;
    state: "partial-call" | "call" | "result";
    result?: unknown;
  };
};

type StreamReasoningPart = {
  type: "reasoning";
  reasoning?: string;
  details?: Array<{ type: string; text?: string; data?: string; signature?: string }>;
};

/* ── Persisted format (database) ────────────────────────────────────── */
type PersistedToolPart = {
  type: `tool-${string}`;
  state?: string;
  input?: unknown;
  output?: unknown;
  toolCallId?: string | null;
};

type PersistedReasoningPart = {
  type: "reasoning";
  text?: string;
  details?: Array<{ type: string; text?: string }>;
};

type UiPart =
  | { type: "text"; text?: string }
  | ToolInvocationPart
  | PersistedToolPart
  | StreamReasoningPart
  | PersistedReasoningPart
  | { type: "step-start" }
  | { type: string; [key: string]: unknown };

type UiMessage = { id: string; role: "user" | "assistant" | string; parts?: UiPart[] };

/* ── Normalised shape for tool rendering ────────────────────────────── */
type NormalisedTool = {
  toolName: string;
  toolCallId: string | null;
  input: unknown;
  output: unknown;
  isRunning: boolean;
  stateLabel: string;
};

function readReasoningText(part: UiPart): string {
  if (part.type !== "reasoning") return "";
  const p = part as StreamReasoningPart & PersistedReasoningPart;
  return (
    p.reasoning ??
    p.text ??
    (p.details?.filter((d) => d.type === "text").map((d) => d.text ?? d.data ?? "").join("") || "")
  );
}

function readTextPart(part: UiPart): string | null {
  if (part.type !== "text") return null;
  const candidate = part as { text?: unknown; content?: unknown; value?: unknown };
  const value = candidate.text ?? candidate.content ?? candidate.value;
  if (typeof value !== "string") return null;
  const cleaned = stripToolContextEchoes(value);
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeToolName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function normaliseToolPart(part: UiPart, index: number): NormalisedTool | null {
  if (part.type === "tool-invocation") {
    const inv = (part as ToolInvocationPart).toolInvocation;
    if (!inv) return null;
    return {
      toolName: inv.toolName,
      toolCallId: inv.toolCallId ?? null,
      input: inv.args ?? null,
      output: inv.result ?? null,
      isRunning: inv.state === "partial-call" || inv.state === "call",
      stateLabel: inv.state === "result" ? "output-available" : inv.state === "call" ? "input-available" : inv.state,
    };
  }
  if (part.type.startsWith("tool-")) {
    const p = part as PersistedToolPart;
    return {
      toolName: p.type.replace("tool-", ""),
      toolCallId: (p.toolCallId as string) ?? null,
      input: p.input ?? null,
      output: p.output ?? null,
      isRunning: p.state === "input-available" || p.state === "partial-call",
      stateLabel: p.state ?? "completed",
    };
  }
  return null;
}

function ToolPartView({ tool, index }: { tool: NormalisedTool; index: number }) {
  const hasInput = tool.input != null;
  const hasOutput = tool.output != null;
  const normalizedToolName = normalizeToolName(tool.toolName);
  const isCreateChartTool = normalizedToolName === "create_chart";
  const isCouncilTool = normalizeToolName(tool.toolName) === "council_deliberation";

  if (isCouncilTool && hasOutput) {
    return <CouncilDeliberationToolView key={`${tool.toolName}-${tool.toolCallId ?? index}`} output={tool.output} />;
  }

  if (hasOutput && isVizArtifactCandidate(tool.toolName, tool.output)) {
    const chartSpec =
      normalizedToolName === "create_chart" && isChartSpec(tool.output) ? tool.output : buildChartSpecFromVizHint(tool.output);
    const payload: VizPayload = {
      id: `inline:${tool.toolCallId ?? `${tool.toolName}:${index}`}`,
      toolName: tool.toolName,
      data: tool.output,
      title: `Chart: ${tool.toolName}`,
      chartSpec: chartSpec ?? undefined,
    };
    return <InlineArtifact key={`${tool.toolName}-${tool.toolCallId ?? index}`} payload={payload} tool={tool} />;
  }

  return (
    <details
      key={`${tool.toolName}-${tool.toolCallId ?? index}`}
      className="rounded-md border border-(--color-border) bg-(--color-card)/60 p-2 text-xs"
      open={tool.stateLabel === "output-available" && !isCreateChartTool}
    >
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">
            {tool.isRunning ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-(--color-primary)" />
                {tool.toolName}
              </span>
            ) : (
              tool.toolName
            )}
          </span>
          <span className="rounded-full border border-(--color-border) px-2 py-0.5 text-[10px] uppercase tracking-wide text-(--color-muted-foreground)">
            {tool.stateLabel}
          </span>
        </div>
      </summary>
      <div className="mt-2 space-y-2">
        {hasInput ? (
          <div>
            <p className="mb-1 text-[11px] font-medium text-(--color-muted-foreground)">Input</p>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-(--color-background) p-2 text-[11px]">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>
        ) : null}
        {hasOutput ? (
          <div>
            <p className="mb-1 text-[11px] font-medium text-(--color-muted-foreground)">Output</p>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-(--color-background) p-2 text-[11px]">
              {JSON.stringify(tool.output, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function InlineArtifact({ payload, tool }: { payload: VizPayload; tool: NormalisedTool }) {
  const vizRef = useRef<HTMLDivElement | null>(null);
  const dataRows = useMemo(() => {
    if (payload.chartSpec?.data?.length) return payload.chartSpec.data;
    return null;
  }, [payload.chartSpec]);
  const sources = useMemo(() => {
    const fromSpec = Array.isArray(payload.chartSpec?.sources) ? payload.chartSpec.sources : [];
    const toolName = tool.toolName ? [tool.toolName] : [];
    return Array.from(new Set([...fromSpec, ...toolName])).filter(Boolean);
  }, [payload.chartSpec, tool.toolName]);
  const inputJson = useMemo(() => (tool.input != null ? JSON.stringify(tool.input, null, 2) : ""), [tool.input]);

  return (
    <div className="group relative">
      <div ref={vizRef}>
        <VizCompactContext.Provider value={true}>
          <Suspense fallback={<div className="p-4 text-center text-xs text-(--color-muted-foreground)">Loading...</div>}>
            <VizRouter payload={payload} />
          </Suspense>
        </VizCompactContext.Provider>
      </div>
      <div className="pointer-events-none absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
        <ArtifactToolbar payload={payload} targetRef={vizRef} className="flex gap-1" />
      </div>
      {dataRows ? (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-[11px] text-(--color-muted-foreground)">
            Data
            {sources.length > 0 ? (
              <span className="ml-2 text-(--color-muted-foreground)/80">· source: {sources.join(", ")}</span>
            ) : null}
          </summary>
          <DataRowsTable rows={dataRows} />
        </details>
      ) : inputJson ? (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-[11px] text-(--color-muted-foreground)">
            Request
            {sources.length > 0 ? (
              <span className="ml-2 text-(--color-muted-foreground)/80">· source: {sources.join(", ")}</span>
            ) : null}
          </summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-(--color-background) p-2 text-[11px]">{inputJson}</pre>
        </details>
      ) : null}
    </div>
  );
}

function DataRowsTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  const headers = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows.slice(0, 50)) {
      for (const key of Object.keys(row)) seen.add(key);
    }
    return Array.from(seen);
  }, [rows]);
  const displayRows = rows.slice(0, 50);
  return (
    <div className="mt-1 overflow-x-auto rounded bg-(--color-background) p-2 text-[11px]">
      <table className="w-full text-left">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col" className="border-b border-(--color-border) py-1 pr-3 font-medium text-(--color-muted-foreground)">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {headers.map((header) => {
                const value = row[header];
                const display =
                  value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
                return (
                  <td key={header} className="border-b border-(--color-border)/60 py-1 pr-3">
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > displayRows.length ? (
        <p className="mt-1 text-(--color-muted-foreground)">Showing {displayRows.length} of {rows.length} rows.</p>
      ) : null}
    </div>
  );
}

function CouncilDeliberationToolView({ output }: { output: unknown }) {
  const root = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
  const issue = typeof root.issue === "string" ? root.issue : "Council deliberation";
  const displayName = typeof root.displayName === "string" ? root.displayName : "Selected area";
  const turns = Array.isArray(root.turns)
    ? root.turns.filter((turn): turn is Record<string, unknown> => typeof turn === "object" && turn !== null)
    : [];
  const resolution = root.resolution && typeof root.resolution === "object" ? (root.resolution as Record<string, unknown>) : null;
  const actionable = Array.isArray(resolution?.actionableSteps)
    ? resolution?.actionableSteps.filter((item): item is string => typeof item === "string")
    : [];

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-(--color-border) bg-(--color-card)/60 p-2 text-xs">
        <p className="font-medium text-(--color-foreground)">LLM Council - {displayName}</p>
        <p className="mt-1 text-(--color-muted-foreground)">{issue}</p>
      </div>

      {turns.map((turn, index) => {
        const name = typeof turn.agentName === "string" ? turn.agentName : typeof turn.agent_name === "string" ? turn.agent_name : "Representative";
        const title = typeof turn.agentTitle === "string" ? turn.agentTitle : typeof turn.agent_title === "string" ? turn.agent_title : "";
        const content = typeof turn.content === "string" ? turn.content : "";
        if (!content) return null;
        return (
          <Card key={`council-turn-${index}`} className="max-w-[90%] border border-(--color-border) bg-(--color-card)/40 p-3 text-sm">
            <p className="mb-1 text-xs text-(--color-muted-foreground)">
              {name}
              {title ? ` - ${title}` : ""}
            </p>
            <p className="whitespace-pre-wrap">{content}</p>
          </Card>
        );
      })}

      {actionable.length > 0 ? (
        <div className="rounded-md border border-(--color-border) bg-(--color-card)/60 p-2 text-xs">
          <p className="mb-1 font-medium text-(--color-foreground)">Resolution</p>
          <ul className="list-disc space-y-1 pl-4 text-(--color-muted-foreground)">
            {actionable.slice(0, 5).map((step, index) => (
              <li key={`resolution-step-${index}`}>{step}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ReasoningPartView({ part }: { part: UiPart }) {
  const text = readReasoningText(part);
  if (!text) return null;
  return (
    <details className="text-xs" open>
      <summary className="cursor-pointer text-(--color-muted-foreground)">Thinking</summary>
      <div className="prose-chat mt-1 text-(--color-muted-foreground)">
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      </div>
    </details>
  );
}

function lastPartSignature(message: UiMessage): string {
  const parts = message.parts ?? [];
  if (parts.length === 0) return "";
  const last = parts[parts.length - 1] as UiPart & {
    text?: unknown;
    reasoning?: unknown;
    state?: unknown;
    toolInvocation?: { state?: unknown; result?: unknown };
    output?: unknown;
  };
  const type = last.type ?? "";
  if (type === "text") {
    const text = typeof last.text === "string" ? last.text : "";
    return `text:${text.length}`;
  }
  if (type === "reasoning") {
    const r = typeof last.reasoning === "string" ? last.reasoning : typeof last.text === "string" ? last.text : "";
    return `reason:${r.length}`;
  }
  if (type === "tool-invocation") {
    const inv = last.toolInvocation;
    const state = inv?.state ?? "";
    const hasResult = inv?.result != null ? 1 : 0;
    return `ti:${String(state)}:${hasResult}`;
  }
  if (typeof type === "string" && type.startsWith("tool-")) {
    const state = last.state ?? "";
    const hasOutput = last.output != null ? 1 : 0;
    return `${type}:${String(state)}:${hasOutput}`;
  }
  return String(type);
}

// Assumes the AI SDK only mutates the trailing part during streaming — earlier
// parts are frozen once a new part is appended. If that invariant ever changes,
// widen the signature to cover all parts.
function messagePropsEqual(
  prev: { message: UiMessage },
  next: { message: UiMessage },
): boolean {
  const a = prev.message;
  const b = next.message;
  if (a === b) return true;
  if (a.id !== b.id) return false;
  if (a.role !== b.role) return false;
  const ap = a.parts ?? [];
  const bp = b.parts ?? [];
  if (ap.length !== bp.length) return false;
  return lastPartSignature(a) === lastPartSignature(b);
}

function MessageImpl({ message }: { message: UiMessage }) {
  const parts = message.parts ?? [];
  const hasAnyContent = parts.length > 0;
  const renderedParts = parts.map((part, index) => {
    const textPart = readTextPart(part);
    if (textPart) {
      return <MessageResponse key={`text-${index}`}>{textPart}</MessageResponse>;
    }

    if (part.type === "step-start") return null;

    const tool = normaliseToolPart(part, index);
    if (tool) {
      return <ToolPartView key={`tool-${tool.toolCallId ?? index}`} tool={tool} index={index} />;
    }

    if (part.type === "reasoning") {
      return <ReasoningPartView key={`reasoning-${index}`} part={part} />;
    }

    return null;
  });

  const hasVisibleContent = renderedParts.some(Boolean);

  const content = (
    <div className="space-y-2">
      {hasVisibleContent ? renderedParts : hasAnyContent ? null : <StreamingIndicator />}
    </div>
  );

  return (
    <div className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
      {message.role === "user" ? (
        <Card className="max-w-[80%] border-0 bg-(--color-primary)/15 text-sm">{content}</Card>
      ) : (
        <div className="max-w-[80%] text-sm">{content}</div>
      )}
    </div>
  );
}

export const Message = memo(MessageImpl, messagePropsEqual);

function StreamingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1">
      <span className="inline-block h-1.5 w-1.5 animate-[streamDot_900ms_ease-out_infinite] rounded-full bg-(--color-muted-foreground) [animation-delay:0ms]" />
      <span className="inline-block h-1.5 w-1.5 animate-[streamDot_900ms_ease-out_infinite] rounded-full bg-(--color-muted-foreground) [animation-delay:150ms]" />
      <span className="inline-block h-1.5 w-1.5 animate-[streamDot_900ms_ease-out_infinite] rounded-full bg-(--color-muted-foreground) [animation-delay:300ms]" />
    </div>
  );
}

export function AssistantThinkingMessage() {
  return (
    <div className="flex justify-start">
      <div className="inline-flex items-center gap-3 py-1 text-(--color-muted-foreground)">
        <span className="algo-thinking-glyph" aria-hidden>
          <span className="algo-thinking-core">◆</span>
          <span className="algo-thinking-orbit algo-thinking-orbit-a" />
          <span className="algo-thinking-orbit algo-thinking-orbit-b" />
        </span>
        <span className="text-xs tracking-wide">Thinking...</span>
      </div>
    </div>
  );
}

export function MessageResponse({ children }: { children: string }) {
  const segments = useMemo(() => splitTextIntoChartSegments(children), [children]);
  if (segments.length === 1 && segments[0].kind === "text") {
    return (
      <div className="prose-chat text-sm leading-relaxed">
        <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
      </div>
    );
  }
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          if (!segment.text.trim()) return null;
          return (
            <div key={`seg-text-${index}`} className="prose-chat">
              <Markdown remarkPlugins={[remarkGfm]}>{segment.text}</Markdown>
            </div>
          );
        }
        return (
          <Suspense
            key={`seg-chart-${index}`}
            fallback={<div className="p-4 text-center text-xs text-(--color-muted-foreground)">Loading chart...</div>}
          >
            <DataDrivenChart spec={segment.spec} />
          </Suspense>
        );
      })}
    </div>
  );
}
