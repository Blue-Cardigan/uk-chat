import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type UiPart =
  | { type: "text"; text?: string }
  | { type: `tool-${string}`; state?: string; input?: unknown; output?: unknown; toolCallId?: string | null }
  | { type: "reasoning"; text?: string; details?: Array<{ type: string; text?: string }> }
  | { type: string; [key: string]: unknown };

type UiMessage = { id: string; role: "user" | "assistant" | string; parts?: UiPart[] };

function ToolPart({ part, index }: { part: Extract<UiPart, { type: `tool-${string}` }>; index: number }) {
  const toolName = part.type.replace("tool-", "");
  const hasInput = "input" in part && part.input != null;
  const hasOutput = "output" in part && part.output != null;
  const stateLabel = part.state ?? "completed";
  const isRunning = stateLabel === "input-available" || stateLabel === "partial-call";

  return (
    <details
      key={`${toolName}-${part.toolCallId ?? index}`}
      className="rounded-md border border-(--color-border) bg-(--color-card)/60 p-2 text-xs"
      open={stateLabel === "output-available"}
    >
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">
            {isRunning ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                {toolName}
              </span>
            ) : (
              toolName
            )}
          </span>
          <span className="rounded-full border border-(--color-border) px-2 py-0.5 text-[10px] uppercase tracking-wide text-(--color-muted-foreground)">
            {stateLabel}
          </span>
        </div>
      </summary>
      <div className="mt-2 space-y-2">
        {hasInput ? (
          <div>
            <p className="mb-1 text-[11px] font-medium text-(--color-muted-foreground)">Input</p>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-(--color-background) p-2 text-[11px]">
              {JSON.stringify(part.input, null, 2)}
            </pre>
          </div>
        ) : null}
        {hasOutput ? (
          <div>
            <p className="mb-1 text-[11px] font-medium text-(--color-muted-foreground)">Output</p>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-(--color-background) p-2 text-[11px]">
              {JSON.stringify(part.output, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function ReasoningPart({ part }: { part: Extract<UiPart, { type: "reasoning" }> }) {
  const text = part.text ?? (part.details?.filter((d) => d.type === "text").map((d) => d.text).join("") || "");
  if (!text) return null;
  return (
    <details className="text-xs" open>
      <summary className="cursor-pointer text-(--color-muted-foreground)">Thinking</summary>
      <div className="mt-1 whitespace-pre-wrap text-(--color-muted-foreground)">{text}</div>
    </details>
  );
}

export function Message({ message }: { message: UiMessage }) {
  const parts = message.parts ?? [];
  const hasAnyContent = parts.length > 0;

  const renderedParts = parts.map((part, index) => {
    if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
      return <MessageResponse key={`text-${index}`}>{part.text}</MessageResponse>;
    }
    if (part.type.startsWith("tool-")) {
      const toolPart = part as Extract<UiPart, { type: `tool-${string}` }>;
      return <ToolPart key={`tool-${toolPart.toolCallId ?? index}`} part={toolPart} index={index} />;
    }
    if (part.type === "reasoning") {
      return <ReasoningPart key={`reasoning-${index}`} part={part as Extract<UiPart, { type: "reasoning" }>} />;
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

export function MessageResponse({ children }: { children: string }) {
  return (
    <div className="prose-chat text-sm leading-relaxed">
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}
