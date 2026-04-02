import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

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

function isProviderRedactedReasoning(part: UiPart): boolean {
  const text = readReasoningText(part);
  if (!text) return false;
  const trimmed = text.trim();
  return (
    trimmed === "[REDACTED]" ||
    trimmed.toLowerCase() === "redacted" ||
    trimmed.toLowerCase().includes("[redacted]")
  );
}

function readTextPart(part: UiPart): string | null {
  if (part.type !== "text") return null;
  const candidate = part as { text?: unknown; content?: unknown; value?: unknown };
  const value = candidate.text ?? candidate.content ?? candidate.value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
}

function hasRenderableNonReasoningContent(part: UiPart): boolean {
  if (part.type === "step-start" || part.type === "reasoning") return false;
  if (readTextPart(part)) return true;
  const tool = normaliseToolPart(part, 0);
  return Boolean(tool);
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
  const isCreateChartTool = normalizeToolName(tool.toolName) === "create_chart";
  const isCouncilTool = normalizeToolName(tool.toolName) === "council_deliberation";

  if (isCouncilTool && hasOutput) {
    return <CouncilDeliberationToolView key={`${tool.toolName}-${tool.toolCallId ?? index}`} output={tool.output} />;
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
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
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

function ReasoningPartView({ part, hideRedacted }: { part: UiPart; hideRedacted: boolean }) {
  const text = readReasoningText(part);
  if (!text) return null;
  const isProviderRedacted = isProviderRedactedReasoning(part);
  if (isProviderRedacted) {
    if (hideRedacted) return null;
    return (
      <div className="inline-flex items-center gap-2 py-1 text-xs text-(--color-muted-foreground)">
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-(--color-muted-foreground) [animation-delay:0ms]" />
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-(--color-muted-foreground) [animation-delay:150ms]" />
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-(--color-muted-foreground) [animation-delay:300ms]" />
        <span>Thinking...</span>
      </div>
    );
  }
  return (
    <details className="text-xs" open>
      <summary className="cursor-pointer text-(--color-muted-foreground)">Thinking</summary>
      <div className="prose-chat mt-1 text-(--color-muted-foreground)">
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      </div>
    </details>
  );
}

export function Message({ message }: { message: UiMessage }) {
  const parts = message.parts ?? [];
  const hasAnyContent = parts.length > 0;
  const hasNonReasoningContent = parts.some(hasRenderableNonReasoningContent);
  const firstRedactedReasoningIndex = parts.findIndex(isProviderRedactedReasoning);

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
      return (
        <ReasoningPartView
          key={`reasoning-${index}`}
          part={part}
          hideRedacted={hasNonReasoningContent || (isProviderRedactedReasoning(part) && index !== firstRedactedReasoningIndex)}
        />
      );
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

function StreamingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1">
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-(--color-muted-foreground) [animation-delay:0ms]" />
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-(--color-muted-foreground) [animation-delay:150ms]" />
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-(--color-muted-foreground) [animation-delay:300ms]" />
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
  return (
    <div className="prose-chat text-sm leading-relaxed">
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}
