import { PromptInput } from "@/components/ai-elements/prompt-input";

export function ChatInput({
  onSubmit,
  isStreaming,
}: {
  onSubmit: (text: string) => void;
  isStreaming: boolean;
}) {
  return <PromptInput onSubmit={onSubmit} isLoading={isStreaming} placeholder="Ask anything about the UK..." />;
}
