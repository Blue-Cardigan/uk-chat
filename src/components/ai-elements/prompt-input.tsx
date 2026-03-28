import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, AudioLines, Plus, Wrench } from "lucide-react";
import { Button, Textarea } from "@/components/ui/primitives";
import type { ChatModelConfig, ChatModelId } from "@/lib/chat-models";
import type { ChatToolOption } from "@/components/chat/ChatInput";

export function PromptInput({
  onSubmit,
  isLoading,
  placeholder,
  modelId,
  onModelChange,
  modelOptions,
  tools,
  toolsLoading,
}: {
  onSubmit: (text: string) => void;
  isLoading?: boolean;
  placeholder?: string;
  modelId: ChatModelId;
  onModelChange: (modelId: ChatModelId) => void;
  modelOptions: ChatModelConfig[];
  tools: ChatToolOption[];
  toolsLoading: boolean;
}) {
  const [value, setValue] = useState("");
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const canSubmit = value.trim().length > 0 && !isLoading;
  const slashQuery = useMemo(() => {
    const trimmed = value.trimStart();
    if (!trimmed.startsWith("/")) return null;
    return trimmed.slice(1).toLowerCase();
  }, [value]);
  const slashMatches = useMemo(() => {
    if (slashQuery === null) return [];
    const normalized = slashQuery.trim();
    if (!normalized) return tools.slice(0, 8);
    return tools
      .filter((tool) => {
        const haystack = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
        return haystack.includes(normalized);
      })
      .slice(0, 24);
  }, [slashQuery, tools]);
  const showSlashMenu = slashQuery !== null;
  const isEmptySlashQuery = slashQuery !== null && slashQuery.trim().length === 0;

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  }

  function insertTool(tool: ChatToolOption) {
    setValue(`/${tool.name} `);
  }

  useEffect(() => {
    setSlashMenuIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    if (!showSlashMenu) return;
    function onPointerDown(event: PointerEvent) {
      if (!formRef.current) return;
      if (formRef.current.contains(event.target as Node)) return;
      setValue((current) => (current.trimStart().startsWith("/") ? current.replace(/^\s*\/\S*\s*/, "") : current));
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [showSlashMenu]);

  return (
    <form
      ref={formRef}
      aria-label="Chat composer"
      role="search"
      className="rounded-3xl border border-(--color-border) bg-[color-mix(in_oklch,var(--color-card)_82%,var(--color-background)_18%)] p-3 shadow-[0_10px_30px_-24px_rgba(0,0,0,0.95)] transition-colors focus-within:border-[color-mix(in_oklch,var(--color-primary)_26%,var(--color-border)_74%)]"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
    >
      {showSlashMenu ? (
        <div className="mb-2 max-h-64 overflow-y-auto rounded-2xl border border-(--color-border) bg-(--color-card) p-1.5 shadow-lg">
          <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-(--color-muted-foreground)">
            {isEmptySlashQuery ? "Suggested tools" : `Tool matches (${slashMatches.length})`}
          </p>
          {toolsLoading ? (
            <p className="px-2 py-2 text-sm text-(--color-muted-foreground)">Loading tools...</p>
          ) : slashMatches.length === 0 ? (
            <p className="px-2 py-2 text-sm text-(--color-muted-foreground)">No tool matches. Keep typing to refine.</p>
          ) : (
            slashMatches.map((tool, index) => (
              <button
                key={`${tool.name}-${index}`}
                type="button"
                className={`flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-[color-mix(in_oklch,var(--color-card)_50%,var(--color-foreground)_10%)] ${
                  index === slashMenuIndex ? "bg-[color-mix(in_oklch,var(--color-card)_50%,var(--color-foreground)_10%)]" : ""
                }`}
                onMouseEnter={() => setSlashMenuIndex(index)}
                onClick={() => insertTool(tool)}
              >
                <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--color-muted-foreground)" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-(--color-foreground)">
                    /{tool.name}
                  </span>
                  <span className="line-clamp-1 block text-xs text-(--color-muted-foreground)">{tool.description}</span>
                </span>
                <span className="rounded-full border border-(--color-border) px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-(--color-muted-foreground)">
                  {tool.category}
                </span>
              </button>
            ))
          )}
          {isEmptySlashQuery && tools.length > 8 ? (
            <p className="px-2 pt-1 text-xs text-(--color-muted-foreground)">
              Showing top tools. Type after <code>/</code> to filter the full list.
            </p>
          ) : null}
        </div>
      ) : null}
      <Textarea
        placeholder={placeholder ?? "Ask a UK data question..."}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (showSlashMenu && slashMatches.length > 0) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSlashMenuIndex((current) => (current + 1) % slashMatches.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSlashMenuIndex((current) => (current - 1 + slashMatches.length) % slashMatches.length);
              return;
            }
            if (event.key === "Tab") {
              event.preventDefault();
              insertTool(slashMatches[slashMenuIndex] ?? slashMatches[0]);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              insertTool(slashMatches[slashMenuIndex] ?? slashMatches[0]);
              return;
            }
          }
          if (event.key === "Escape" && showSlashMenu) {
            event.preventDefault();
            setValue((current) => current.replace(/^\s*\/\S*\s*/, ""));
            return;
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSubmit();
          }
        }}
        className="min-h-[86px] resize-none border-0 bg-transparent px-1 py-1.5 text-[15px] leading-relaxed placeholder:text-(--color-muted-foreground) focus:ring-0"
      />
      <div className="mt-2 flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          aria-label="Add attachment"
          className="h-8 w-8 rounded-full p-0 text-(--color-muted-foreground) hover:bg-[color-mix(in_oklch,var(--color-card)_60%,var(--color-foreground)_12%)]"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <label
            className="relative inline-flex h-8 items-center rounded-full pl-2.5 pr-6 text-sm text-(--color-muted-foreground) transition-colors hover:bg-[color-mix(in_oklch,var(--color-card)_60%,var(--color-foreground)_12%)]"
            aria-label="Select model"
          >
            <select
              value={modelId}
              onChange={(event) => onModelChange(event.target.value as ChatModelId)}
              className="cursor-pointer appearance-none bg-transparent pr-1 text-sm outline-none"
            >
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id} className="bg-(--color-card) text-(--color-foreground)">
                  {model.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2 text-xs">v</span>
          </label>
          {canSubmit ? (
            <Button
              type="submit"
              variant="accent"
              className="h-9 w-9 rounded-xl p-0"
              aria-label="Send message"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              disabled
              className="h-9 w-9 rounded-xl p-0 text-(--color-muted-foreground)"
              aria-label={isLoading ? "Streaming response" : "Ready to type"}
            >
              <AudioLines className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
