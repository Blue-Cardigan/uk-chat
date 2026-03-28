export const CHAT_SUPPORT_CONTACT = "contact jethro <jethro@explorethekingdom.co.uk> for more";

export type ChatModelId = "flash" | "pro";

export type ChatModelConfig = {
  id: ChatModelId;
  label: string;
  providerModel: string;
  dailyLimit: number;
};

export const CHAT_MODEL_CONFIGS: ChatModelConfig[] = [
  {
    id: "flash",
    label: "Flash",
    providerModel: "gemini-3-flash-preview",
    dailyLimit: 80,
  },
  {
    id: "pro",
    label: "Pro",
    providerModel: "gemini-2.5-pro",
    dailyLimit: 15,
  },
];

export const DEFAULT_CHAT_MODEL_ID: ChatModelId = "flash";

export function getChatModelConfig(modelId?: string | null): ChatModelConfig {
  return CHAT_MODEL_CONFIGS.find((model) => model.id === modelId) ?? CHAT_MODEL_CONFIGS[0];
}
