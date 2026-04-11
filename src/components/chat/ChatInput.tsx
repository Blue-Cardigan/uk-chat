import { PromptInput, type PromptInputSubmitPayload } from "@/components/ai-elements/prompt-input";
import type { VizPayload } from "@/lib/types";
import { CHAT_MODEL_CONFIGS, type ChatModelId } from "@/shared/chat-models";

export type ChatToolOption = {
  name: string;
  description: string;
  category: "data" | "analysis" | "system";
  recommended: boolean;
};

export function ChatInput({
  value,
  onValueChange,
  onSubmit,
  onCouncilModeChange,
  councilModeEnabled,
  isStreaming,
  modelId,
  onModelChange,
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
  isStreaming: boolean;
  modelId: ChatModelId;
  onModelChange: (modelId: ChatModelId) => void;
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
  return (
    <PromptInput
      value={value}
      onValueChange={onValueChange}
      onSubmit={onSubmit}
      onCouncilModeChange={onCouncilModeChange}
      councilModeEnabled={councilModeEnabled}
      isLoading={isStreaming}
      placeholder="Type / for tools"
      councilPlaceholder="Council mode: include a postcode or constituency name for a local MP + councillors council. If omitted, we'll create a national MPs council."
      modelId={modelId}
      onModelChange={onModelChange}
      modelOptions={CHAT_MODEL_CONFIGS}
      tools={tools}
      toolsLoading={toolsLoading}
      toolsHasMore={toolsHasMore}
      toolsLoadingMore={toolsLoadingMore}
      selectedTools={selectedTools}
      onToggleToolSelection={onToggleToolSelection}
      onToolsQueryChange={onToolsQueryChange}
      onLoadMoreTools={onLoadMoreTools}
      pinnedArtifacts={pinnedArtifacts}
      onRemovePinnedArtifact={onRemovePinnedArtifact}
      focusRequestKey={focusRequestKey}
    />
  );
}
