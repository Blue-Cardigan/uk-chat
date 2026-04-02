import { PromptInput, type PromptInputSubmitPayload } from "@/components/ai-elements/prompt-input";
import { CHAT_MODEL_CONFIGS, type ChatModelId } from "@/shared/chat-models";

export type ChatToolOption = {
  name: string;
  description: string;
  category: "data" | "analysis" | "system";
  recommended: boolean;
};

export function ChatInput({
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
}: {
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
}) {
  return (
    <PromptInput
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
    />
  );
}
