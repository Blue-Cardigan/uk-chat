export const CHAT_SUPPORT_CONTACT = "contact jethro <jethro@explorethekingdom.co.uk> for more";

export type ChatModelId = "flash" | "opus" | "gpt" | "sonnet" | "pro";

export type ChatModelConfig = {
  id: ChatModelId;
  label: string;
  providerModel: string;
  dailyLimit: number;
};

export const CHAT_MODEL_CONFIGS: ChatModelConfig[] = [
  {
    id: "flash",
    label: "Gemini Flash",
    providerModel: "google/gemini-3.1-flash-lite-preview",
    dailyLimit: 80,
  },
  {
    id: "opus",
    label: "Opus 4.6",
    providerModel: "anthropic/claude-opus-4.6",
    dailyLimit: 50,
  },
  {
    id: "gpt",
    label: "GPT-5.4",
    providerModel: "openai/gpt-5.4",
    dailyLimit: 50,
  },
  {
    id: "sonnet",
    label: "Claude Sonnet",
    providerModel: "anthropic/claude-sonnet-4.6",
    dailyLimit: 50,
  },
  {
    id: "pro",
    label: "Gemini Pro",
    providerModel: "google/gemini-2.5-pro",
    dailyLimit: 10,
  },
];

export const DEFAULT_CHAT_MODEL_ID: ChatModelId = "flash";

export function getChatModelConfig(modelId?: string | null): ChatModelConfig {
  return CHAT_MODEL_CONFIGS.find((model) => model.id === modelId) ?? CHAT_MODEL_CONFIGS[0];
}
