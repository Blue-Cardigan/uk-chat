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

  return (
    <details
      key={`${tool.toolName}-${tool.toolCallId ?? index}`}
      className="rounded-md border border-(--color-border) bg-(--color-card)/60 p-2 text-xs"
      open={tool.stateLabel === "output-available"}
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

function ReasoningPartView({ part }: { part: UiPart }) {
  const p = part as StreamReasoningPart & PersistedReasoningPart;
  const text =
    p.reasoning ??
    p.text ??
    (p.details?.filter((d) => d.type === "text").map((d) => d.text ?? d.data ?? "").join("") || "");
  if (!text) return null;
  const trimmed = text.trim();
  const isProviderRedacted =
    trimmed === "[REDACTED]" ||
    trimmed.toLowerCase() === "redacted" ||
    trimmed.toLowerCase().includes("[redacted]");
  const displayText = isProviderRedacted ? "Reasoning is hidden by the model provider." : text;
  return (
    <details className="text-xs" open>
      <summary className="cursor-pointer text-(--color-muted-foreground)">Thinking</summary>
      <div className="mt-1 whitespace-pre-wrap text-(--color-muted-foreground)">{displayText}</div>
    </details>
  );
}

export function Message({ message }: { message: UiMessage }) {
  const parts = message.parts ?? [];
  const hasAnyContent = parts.length > 0;

  const renderedParts = parts.map((part, index) => {
    if (part.type === "text" && typeof (part as { text?: string }).text === "string" && ((part as { text: string }).text).length > 0) {
      return <MessageResponse key={`text-${index}`}>{(part as { text: string }).text}</MessageResponse>;
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
