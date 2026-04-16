import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUp, BarChart3, Check, ChevronDown, Landmark, Plus, Wrench, X } from "lucide-react";
import { Button, Textarea } from "@/components/ui/primitives";
import type { ChatModelConfig, ChatModelId } from "@/shared/chat-models";
import type { ChatToolOption } from "@/components/chat/ChatInput";
import type { VizPayload } from "@/lib/types";
import { UK_POSTCODE_REGEX, normalizePostcode } from "@/lib/patterns";

const ACCEPTED_DOCUMENT_EXTENSIONS = new Set(["pdf", "txt", "md", "markdown", "csv", "json", "docx", "xlsx"]);
const ACCEPTED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);
const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

export type PromptInputSubmitPayload = {
  text: string;
  documents: File[];
  mode: "chat" | "council";
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

function getExtension(fileName: string): string {
  const segments = fileName.toLowerCase().split(".");
  return segments.length > 1 ? (segments.at(-1) ?? "") : "";
}

function validateDocument(file: File): string | null {
  const extension = getExtension(file.name);
  const mimeType = file.type.toLowerCase();
  if (!ACCEPTED_DOCUMENT_EXTENSIONS.has(extension)) {
    return `${file.name} is not supported. Upload PDF, TXT, Markdown, CSV, JSON, DOCX, or XLSX files.`;
  }
  if (mimeType && !ACCEPTED_DOCUMENT_MIME_TYPES.has(mimeType)) {
    return `${file.name} has an unsupported format (${mimeType}).`;
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return `${file.name} is too large (${formatBytes(file.size)}). Max file size is ${formatBytes(MAX_DOCUMENT_SIZE_BYTES)}.`;
  }
  return null;
}

function detectCouncilScopeHint(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "Detected scope: National MPs council (default)";
  const postcodeMatch = compact.match(UK_POSTCODE_REGEX);
  if (postcodeMatch?.[1]) {
    return `Detected scope: Local council (postcode ${normalizePostcode(postcodeMatch[1])})`;
  }
  const constituencyMatch = compact.match(
    /\b(?:constituency|in|for|around|near)\s+([a-z0-9][a-z0-9\s'&-]{2,60}?)(?:\b(?:for|on|about|regarding|with|where|which)\b|[,.!?;]|$)/i,
  );
  if (constituencyMatch?.[1]) {
    const area = constituencyMatch[1].trim().replace(/[,.!?;]+$/, "");
    if (area && !["my area", "the area", "my constituency", "the constituency"].includes(area.toLowerCase())) {
      return `Detected scope: Local council (area ${area})`;
    }
  }
  return "Detected scope: National MPs council (default)";
}

export function PromptInput({
  value: initialValue,
  onValueChange,
  onSubmit,
  onCouncilModeChange,
  councilModeEnabled: controlledCouncilModeEnabled,
  isLoading,
  placeholder,
  councilPlaceholder,
  modelId,
  onModelChange,
  modelOptions,
  tools,
  toolsLoading,
  toolsHasMore,
  toolsLoadingMore,
  selectedTools,
  onToggleToolSelection,
  onToolsQueryChange,
  onLoadMoreTools,
  pinnedArtifacts,
  onRemovePinnedArtifact,
  focusRequestKey,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (payload: PromptInputSubmitPayload) => void | Promise<boolean | void>;
  onCouncilModeChange?: (enabled: boolean) => void;
  councilModeEnabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  councilPlaceholder?: string;
  modelId: ChatModelId;
  onModelChange: (modelId: ChatModelId) => void;
  modelOptions: ChatModelConfig[];
  tools: ChatToolOption[];
  toolsLoading: boolean;
  toolsHasMore: boolean;
  toolsLoadingMore: boolean;
  selectedTools: ChatToolOption[];
  onToggleToolSelection: (tool: ChatToolOption) => void;
  onToolsQueryChange: (query: string | null) => void;
  onLoadMoreTools: () => void;
  pinnedArtifacts: VizPayload[];
  onRemovePinnedArtifact: (id: string) => void;
  focusRequestKey?: number;
}) {
  const MENU_HEIGHT = 256;
  const HEADER_HEIGHT = 28;
  const ITEM_HEIGHT = 52;
  const OVERSCAN = 120;

  const [value, setValue] = useState(initialValue);
  const [councilModeEnabled, setCouncilModeEnabled] = useState(controlledCouncilModeEnabled ?? false);
  const [selectedDocuments, setSelectedDocuments] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [menuScrollTop, setMenuScrollTop] = useState(0);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [modelMenuIndex, setModelMenuIndex] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modelOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modelListboxId = useId();
  const toolsListboxId = useId();
  const canSubmit = value.trim().length > 0 && !isLoading;
  const slashQuery = useMemo(() => {
    const trimmed = value.trimStart();
    if (!trimmed.startsWith("/")) return null;
    return trimmed.slice(1).toLowerCase();
  }, [value]);
  const selectedToolNames = useMemo(() => new Set(selectedTools.map((tool) => tool.name)), [selectedTools]);
  const selectedModel = useMemo(
    () => modelOptions.find((option) => option.id === modelId) ?? modelOptions[0],
    [modelId, modelOptions],
  );
  const selectedModelIndex = useMemo(
    () => modelOptions.findIndex((option) => option.id === selectedModel?.id),
    [modelOptions, selectedModel?.id],
  );
  const slashMatches = useMemo(() => {
    if (slashQuery === null) return [];
    const normalized = slashQuery.trim();
    if (!normalized) return tools;
    return tools.filter((tool) => {
      const haystack = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [slashQuery, tools]);
  const showSlashMenu = slashQuery !== null;
  const isEmptySlashQuery = slashQuery !== null && slashQuery.trim().length === 0;
  const groupedTools = useMemo(() => {
    if (!showSlashMenu) return [];
    const nonRecommended = slashMatches.filter((tool) => !tool.recommended);
    const groups: Array<{ id: string; label: string; tools: ChatToolOption[] }> = [];
    if (isEmptySlashQuery) {
      const recommended = slashMatches.filter((tool) => tool.recommended);
      if (recommended.length > 0) groups.push({ id: "recommended", label: "", tools: recommended });
      const byType: Record<"data" | "analysis" | "system", ChatToolOption[]> = {
        data: nonRecommended.filter((tool) => tool.category === "data"),
        analysis: nonRecommended.filter((tool) => tool.category === "analysis"),
        system: nonRecommended.filter((tool) => tool.category === "system"),
      };
      if (byType.data.length > 0) groups.push({ id: "data", label: "Data", tools: byType.data });
      if (byType.analysis.length > 0) groups.push({ id: "analysis", label: "Analysis", tools: byType.analysis });
      if (byType.system.length > 0) groups.push({ id: "system", label: "System", tools: byType.system });
      return groups;
    }
    const byType: Record<"data" | "analysis" | "system", ChatToolOption[]> = {
      data: slashMatches.filter((tool) => tool.category === "data"),
      analysis: slashMatches.filter((tool) => tool.category === "analysis"),
      system: slashMatches.filter((tool) => tool.category === "system"),
    };
    if (byType.data.length > 0) groups.push({ id: "data", label: "Data", tools: byType.data });
    if (byType.analysis.length > 0) groups.push({ id: "analysis", label: "Analysis", tools: byType.analysis });
    if (byType.system.length > 0) groups.push({ id: "system", label: "System", tools: byType.system });
    return groups;
  }, [isEmptySlashQuery, showSlashMenu, slashMatches]);
  const itemRows = useMemo(() => groupedTools.flatMap((group) => group.tools), [groupedTools]);
  const virtualRows = useMemo(() => {
    const rows: Array<
      | { kind: "header"; key: string; label: string; top: number; height: number }
      | { kind: "item"; key: string; tool: ChatToolOption; itemIndex: number; top: number; height: number }
    > = [];
    let y = 0;
    let itemIndex = 0;
    groupedTools.forEach((group) => {
      rows.push({ kind: "header", key: `header-${group.id}`, label: group.label, top: y, height: HEADER_HEIGHT });
      y += HEADER_HEIGHT;
      group.tools.forEach((tool) => {
        rows.push({ kind: "item", key: `tool-${tool.name}-${itemIndex}`, tool, itemIndex, top: y, height: ITEM_HEIGHT });
        y += ITEM_HEIGHT;
        itemIndex += 1;
      });
    });
    return { rows, totalHeight: y };
  }, [groupedTools]);
  const visibleRows = useMemo(
    () =>
      virtualRows.rows.filter(
        (row) =>
          row.top + row.height >= menuScrollTop - OVERSCAN && row.top <= menuScrollTop + MENU_HEIGHT + OVERSCAN,
      ),
    [menuScrollTop, virtualRows.rows],
  );

  const updateValue = useCallback(
    (nextValue: string | ((current: string) => string)) => {
      setValue((current) => {
        const resolved = typeof nextValue === "function" ? nextValue(current) : nextValue;
        onValueChange(resolved);
        return resolved;
      });
    },
    [onValueChange],
  );

  function closeModelMenu({ restoreFocus }: { restoreFocus: boolean }) {
    setIsModelMenuOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => modelMenuTriggerRef.current?.focus());
    }
  }

  function openModelMenu() {
    setModelMenuIndex(Math.max(0, selectedModelIndex));
    setIsModelMenuOpen(true);
  }

  function moveModelMenuFocus(index: number) {
    const nextIndex = Math.max(0, Math.min(index, modelOptions.length - 1));
    setModelMenuIndex(nextIndex);
    modelOptionRefs.current[nextIndex]?.focus();
  }

  async function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      const result = await onSubmit({
        text: trimmed,
        documents: selectedDocuments,
        mode: councilModeEnabled ? "council" : "chat",
      });
      if (result === false) return;
    } catch {
      return;
    }
    updateValue("");
    setSelectedDocuments([]);
    setAttachmentError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function clearSlashPrefix(current: string) {
    return current.replace(/^\s*\/\S*\s*/, "");
  }

  function toggleToolSelection(tool: ChatToolOption) {
    onToggleToolSelection(tool);
    updateValue((current) => clearSlashPrefix(current));
  }

  function handleFileSelection(list: FileList | null) {
    if (!list || list.length === 0) return;
    const nextFiles = Array.from(list);
    const firstError = nextFiles.map(validateDocument).find((error): error is string => Boolean(error)) ?? null;
    if (firstError) {
      setAttachmentError(firstError);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setAttachmentError(null);
    setSelectedDocuments((current) => {
      const byKey = new Map(current.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file] as const));
      nextFiles.forEach((file) => {
        byKey.set(`${file.name}:${file.size}:${file.lastModified}`, file);
      });
      return [...byKey.values()];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  useEffect(() => {
    setSlashMenuIndex(0);
  }, [slashQuery, itemRows.length]);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    if (focusRequestKey == null) return;
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      const cursor = textarea.value.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }, [focusRequestKey]);

  useEffect(() => {
    onToolsQueryChange(showSlashMenu ? slashQuery?.trim() ?? "" : null);
  }, [onToolsQueryChange, showSlashMenu, slashQuery]);

  useEffect(() => {
    if (!showSlashMenu) return;
    function onPointerDown(event: PointerEvent) {
      if (!formRef.current) return;
      if (formRef.current.contains(event.target as Node)) return;
      updateValue((current) => (current.trimStart().startsWith("/") ? clearSlashPrefix(current) : current));
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [showSlashMenu, updateValue]);

  useEffect(() => {
    if (!isModelMenuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!modelMenuRef.current) return;
      if (modelMenuRef.current.contains(event.target as Node)) return;
      closeModelMenu({ restoreFocus: false });
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeModelMenu({ restoreFocus: true });
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isModelMenuOpen]);

  useEffect(() => {
    if (!isLoading) return;
    setIsModelMenuOpen(false);
  }, [isLoading]);

  useEffect(() => {
    onCouncilModeChange?.(councilModeEnabled);
  }, [councilModeEnabled, onCouncilModeChange]);

  useEffect(() => {
    if (typeof controlledCouncilModeEnabled !== "boolean") return;
    setCouncilModeEnabled(controlledCouncilModeEnabled);
  }, [controlledCouncilModeEnabled]);

  useEffect(() => {
    if (!isModelMenuOpen) return;
    moveModelMenuFocus(Math.max(0, selectedModelIndex));
  }, [isModelMenuOpen, selectedModelIndex]);

  return (
    <form
      ref={formRef}
      aria-label="Chat composer"
      className="rounded-3xl border border-(--color-border) bg-[color-mix(in_oklch,var(--color-card)_82%,var(--color-background)_18%)] p-3 shadow-md transition-colors focus-within:border-[color-mix(in_oklch,var(--color-primary)_26%,var(--color-border)_74%)]"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      {selectedTools.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedTools.map((tool) => (
            <button
              key={`selected-${tool.name}`}
              type="button"
              aria-label={`Remove /${tool.name} tool`}
              className="inline-flex items-center gap-1 rounded-full border border-(--color-border) bg-(--color-card) px-2 py-1 text-xs"
              onClick={() => onToggleToolSelection(tool)}
            >
              <span>/{tool.name}</span>
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      ) : null}
      {pinnedArtifacts.length > 0 ? (
        <div className="mb-2 space-y-1.5">
          <p className="text-[11px] text-(--color-muted-foreground)">Using {pinnedArtifacts.length} artifact(s) as context</p>
          <div className="flex flex-wrap gap-1.5">
            {pinnedArtifacts.map((artifact) => (
              <button
                key={`artifact-context-${artifact.id}`}
                type="button"
                aria-label={`Remove ${artifact.title ?? artifact.toolName} from context`}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-(--color-border) bg-(--color-card) px-2 py-1 text-xs"
                onClick={() => onRemovePinnedArtifact(artifact.id)}
              >
                <BarChart3 className="h-3 w-3 shrink-0 text-(--color-muted-foreground)" />
                <span className="max-w-[200px] truncate">{artifact.title ?? artifact.toolName}</span>
                <X className="h-3 w-3 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {selectedDocuments.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedDocuments.map((document) => (
            <button
              key={`${document.name}:${document.size}:${document.lastModified}`}
              type="button"
              aria-label={`Remove ${document.name}`}
              className="inline-flex items-center gap-1 rounded-full border border-(--color-border) bg-(--color-card) px-2 py-1 text-xs"
              onClick={() =>
                setSelectedDocuments((current) =>
                  current.filter(
                    (file) => !(file.name === document.name && file.size === document.size && file.lastModified === document.lastModified),
                  ),
                )
              }
            >
              <span className="max-w-[180px] truncate">{document.name}</span>
              <span className="text-(--color-muted-foreground)">({formatBytes(document.size)})</span>
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      ) : null}
      {showSlashMenu ? (
        <div className="mb-2 rounded-2xl border border-(--color-border) bg-(--color-card) p-1.5 shadow-lg">
          <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-(--color-muted-foreground)">
            {isEmptySlashQuery ? "Recommended and grouped tools" : `Tool matches (${slashMatches.length})`}
          </p>
          {toolsLoading ? (
            <p className="px-2 py-2 text-sm text-(--color-muted-foreground)">Loading tools...</p>
          ) : itemRows.length === 0 ? (
            <p className="px-2 py-2 text-sm text-(--color-muted-foreground)">No tool matches. Keep typing to refine.</p>
          ) : (
            <div
              ref={menuRef}
              id={toolsListboxId}
              className="h-64 overflow-y-auto"
              role="listbox"
              aria-label="Available tools"
              onScroll={(event) => {
                const target = event.currentTarget;
                setMenuScrollTop(target.scrollTop);
                const nearBottom = target.scrollHeight - (target.scrollTop + target.clientHeight) < 120;
                if (nearBottom && toolsHasMore && !toolsLoadingMore) onLoadMoreTools();
              }}
            >
              <div className="relative" style={{ height: `${virtualRows.totalHeight}px` }}>
                {visibleRows.map((row) =>
                  row.kind === "header" ? (
                    <div
                      key={row.key}
                      className="absolute left-0 right-0 px-2 py-1 text-[11px] uppercase tracking-wide text-(--color-muted-foreground)"
                      style={{ top: `${row.top}px`, height: `${row.height}px` }}
                    >
                      {row.label}
                    </div>
                  ) : (
                    <button
                      key={row.key}
                      type="button"
                      id={`tool-option-${row.itemIndex}`}
                      role="option"
                      aria-selected={selectedToolNames.has(row.tool.name)}
                      className={`absolute left-0 right-0 flex items-start gap-2 rounded-xl px-2 py-2 text-left transition-colors ${
                        selectedToolNames.has(row.tool.name)
                          ? "bg-[color-mix(in_oklch,var(--color-primary)_18%,var(--color-card)_82%)]"
                          : row.itemIndex === slashMenuIndex
                            ? "bg-[color-mix(in_oklch,var(--color-card)_50%,var(--color-foreground)_10%)]"
                            : "hover:bg-[color-mix(in_oklch,var(--color-card)_50%,var(--color-foreground)_10%)]"
                      }`}
                      style={{ top: `${row.top}px`, height: `${row.height}px` }}
                      onMouseEnter={() => setSlashMenuIndex(row.itemIndex)}
                      onClick={() => toggleToolSelection(row.tool)}
                    >
                      <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--color-muted-foreground)" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-(--color-foreground)">/{row.tool.name}</span>
                        <span className="line-clamp-1 block text-xs text-(--color-muted-foreground)">{row.tool.description}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        {selectedToolNames.has(row.tool.name) ? <Check className="h-3.5 w-3.5 text-(--color-primary)" /> : null}
                        <span className="rounded-full border border-(--color-border) px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-(--color-muted-foreground)">
                          {row.tool.category}
                        </span>
                      </span>
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
          {toolsLoadingMore ? <p className="px-2 pt-1 text-xs text-(--color-muted-foreground)">Loading more tools...</p> : null}
          {isEmptySlashQuery && toolsHasMore ? (
            <p className="px-2 pt-1 text-xs text-(--color-muted-foreground)">
              Scroll for more tools. Type after <code>/</code> to refine.
            </p>
          ) : null}
        </div>
      ) : null}
      <Textarea
        ref={textareaRef}
        placeholder={
          councilModeEnabled
            ? councilPlaceholder ?? "Ask your council question..."
            : placeholder ?? "Ask a UK data question..."
        }
        value={value}
        aria-controls={showSlashMenu ? toolsListboxId : undefined}
        aria-activedescendant={showSlashMenu && itemRows.length > 0 ? `tool-option-${slashMenuIndex}` : undefined}
        onChange={(event) => updateValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Backspace" && value.length === 0 && selectedTools.length > 0) {
            event.preventDefault();
            const last = selectedTools[selectedTools.length - 1];
            if (last) onToggleToolSelection(last);
            return;
          }
          if (showSlashMenu && itemRows.length > 0) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSlashMenuIndex((current) => (current + 1) % itemRows.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSlashMenuIndex((current) => (current - 1 + itemRows.length) % itemRows.length);
              return;
            }
            if (event.key === "Tab") {
              event.preventDefault();
              toggleToolSelection(itemRows[slashMenuIndex] ?? itemRows[0]);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              toggleToolSelection(itemRows[slashMenuIndex] ?? itemRows[0]);
              return;
            }
          }
          if (event.key === "Escape" && showSlashMenu) {
            event.preventDefault();
            updateValue((current) => clearSlashPrefix(current));
            return;
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void handleSubmit();
          }
        }}
        className="min-h-[52px] resize-none border-0 bg-transparent px-1 py-1.5 text-[15px] leading-relaxed placeholder:text-(--color-muted-foreground) focus:ring-0 md:min-h-[86px]"
      />
      {councilModeEnabled ? (
        <p className="mt-1 text-xs text-(--color-muted-foreground)">
          Include a postcode or constituency for local council context. {detectCouncilScopeHint(value)}
        </p>
      ) : null}
      {attachmentError ? <p className="mt-1 text-xs text-(--color-muted-foreground)">{attachmentError}</p> : null}
      <div className="mt-2 flex items-center justify-between">
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          multiple
          accept=".pdf,.txt,.md,.markdown,.csv,.json,.docx,.xlsx,text/plain,text/markdown,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => handleFileSelection(event.currentTarget.files)}
        />
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            aria-label="Add attachment"
            className="h-8 w-8 rounded-full p-0 text-(--color-muted-foreground) hover:bg-[color-mix(in_oklch,var(--color-card)_60%,var(--color-foreground)_12%)]"
            onClick={() => fileInputRef.current?.click()}
            disabled={Boolean(isLoading)}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-pressed={councilModeEnabled}
            aria-label="Toggle LLM council mode"
            className={`inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs ${
              councilModeEnabled
                ? "bg-[color-mix(in_oklch,var(--color-primary)_18%,var(--color-card)_82%)] text-(--color-foreground)"
                : "text-(--color-muted-foreground) hover:bg-[color-mix(in_oklch,var(--color-card)_60%,var(--color-foreground)_12%)]"
            }`}
            onClick={() => setCouncilModeEnabled((current) => !current)}
            disabled={Boolean(isLoading)}
          >
            <Landmark className="h-3.5 w-3.5" />
            <span>Council</span>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div ref={modelMenuRef} className="relative">
            <Button
              ref={modelMenuTriggerRef}
              type="button"
              variant="ghost"
              aria-haspopup="listbox"
              aria-expanded={isModelMenuOpen}
              aria-controls={isModelMenuOpen ? modelListboxId : undefined}
              aria-label={`Model: ${selectedModel?.label ?? "Unknown"}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-sm text-(--color-muted-foreground) hover:bg-[color-mix(in_oklch,var(--color-card)_60%,var(--color-foreground)_12%)]"
              onClick={() => {
                if (isModelMenuOpen) {
                  closeModelMenu({ restoreFocus: false });
                  return;
                }
                openModelMenu();
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  if (!isModelMenuOpen) openModelMenu();
                }
              }}
              disabled={Boolean(isLoading)}
            >
              <span>{selectedModel?.label ?? "Model"}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isModelMenuOpen ? "rotate-180" : ""}`} />
            </Button>
            {isModelMenuOpen ? (
              <div
                id={modelListboxId}
                role="listbox"
                aria-label="Model options"
                className="absolute bottom-10 right-0 z-30 min-w-[150px] rounded-2xl border border-(--color-border) bg-(--color-card) p-1 shadow-lg"
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveModelMenuFocus(modelMenuIndex + 1);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveModelMenuFocus(modelMenuIndex - 1);
                    return;
                  }
                  if (event.key === "Home") {
                    event.preventDefault();
                    moveModelMenuFocus(0);
                    return;
                  }
                  if (event.key === "End") {
                    event.preventDefault();
                    moveModelMenuFocus(modelOptions.length - 1);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeModelMenu({ restoreFocus: true });
                  }
                }}
              >
                {modelOptions.map((model, index) => {
                  const isActive = model.id === modelId;
                  return (
                    <button
                      key={model.id}
                      ref={(node) => {
                        modelOptionRefs.current[index] = node;
                      }}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      tabIndex={index === modelMenuIndex ? 0 : -1}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition-colors ${
                        isActive
                          ? "bg-[color-mix(in_oklch,var(--color-primary)_18%,var(--color-card)_82%)] text-(--color-foreground)"
                          : "text-(--color-muted-foreground) hover:bg-[color-mix(in_oklch,var(--color-card)_50%,var(--color-foreground)_10%)]"
                      }`}
                      onMouseEnter={() => {
                        setModelMenuIndex(index);
                      }}
                      onClick={() => {
                        onModelChange(model.id);
                        closeModelMenu({ restoreFocus: true });
                      }}
                    >
                      <span>{model.label}</span>
                      {isActive ? <Check className="h-3.5 w-3.5 text-(--color-primary)" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {canSubmit ? (
            <Button
              type="submit"
              variant="accent"
              className="h-9 w-9 rounded-xl p-0"
              aria-label="Send message"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
