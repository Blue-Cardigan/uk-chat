import { PromptInput } from "@/components/ai-elements/prompt-input";
import { CHAT_MODEL_CONFIGS, type ChatModelId } from "@/lib/chat-models";

export type ChatToolOption = {
  name: string;
  description: string;
  category: "suggested" | "data" | "analysis" | "system";
};

export function ChatInput({
  onSubmit,
  isStreaming,
  modelId,
  onModelChange,
  tools,
  toolsLoading,
}: {
  onSubmit: (text: string) => void;
  isStreaming: boolean;
  modelId: ChatModelId;
  onModelChange: (modelId: ChatModelId) => void;
  tools: ChatToolOption[];
  toolsLoading: boolean;
}) {
  return (
    <PromptInput
      onSubmit={onSubmit}
      isLoading={isStreaming}
      placeholder="Type / for tools"
      modelId={modelId}
      onModelChange={onModelChange}
      modelOptions={CHAT_MODEL_CONFIGS}
      tools={tools}
      toolsLoading={toolsLoading}
    />
  );
}
