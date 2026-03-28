import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type UiPart =
  | { type: "text"; text?: string }
  | { type: `tool-${string}`; state?: string; input?: unknown; output?: unknown; toolCallId?: string | null }
  | { type: "reasoning"; text?: string }
  | { type: string; [key: string]: unknown };

type UiMessage = { id: string; role: "user" | "assistant" | string; parts?: UiPart[] };

function renderToolPart(part: Extract<UiPart, { type: `tool-${string}` }>, index: number) {
  const toolName = part.type.replace("tool-", "");
  const hasInput = "input" in part && part.input != null;
  const hasOutput = "output" in part && part.output != null;
  const stateLabel = part.state ?? "completed";
  return (
    <details
      key={`${toolName}-${part.toolCallId ?? index}`}
      className="rounded-md border border-(--color-border) bg-(--color-card)/60 p-2 text-xs"
      open={stateLabel === "output-available"}
    >
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">Tool: {toolName}</span>
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

export function Message({ message }: { message: UiMessage }) {
  const textParts =
    message.parts?.filter((part): part is Extract<UiPart, { type: "text" }> => part.type === "text" && typeof part.text === "string") ?? [];
  const toolParts =
    message.parts?.filter((part): part is Extract<UiPart, { type: `tool-${string}` }> => part.type.startsWith("tool-")) ?? [];
  const reasoningParts =
    message.parts?.filter((part): part is Extract<UiPart, { type: "reasoning" }> => part.type === "reasoning" && typeof part.text === "string") ?? [];
  const text = textParts.map((part) => part.text).join("\n");
  const content = (
    <>
      {text ? <MessageResponse>{text}</MessageResponse> : <p className="whitespace-pre-wrap leading-relaxed">...</p>}
      {reasoningParts.length > 0 ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-(--color-muted-foreground)">Reasoning</summary>
          <div className="mt-1 whitespace-pre-wrap">{reasoningParts.map((part) => part.text).join("\n")}</div>
        </details>
      ) : null}
      {toolParts.length > 0 ? <div className="mt-2 space-y-2">{toolParts.map((part, index) => renderToolPart(part, index))}</div> : null}
    </>
  );

  return (
    <div className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
      {message.role === "user" ? (
        <Card className="max-w-[80%] border-0 bg-(--color-primary)/15 text-sm">
          {content}
        </Card>
      ) : (
        <div className="max-w-[80%] text-sm">
          {content}
        </div>
      )}
    </div>
  );
}

export function MessageResponse({ children }: { children: string }) {
  return <p className="whitespace-pre-wrap text-sm leading-relaxed [&_code]:rounded [&_code]:bg-(--color-background) [&_code]:px-1">{children}</p>;
}
