export const CHAT_SUPPORT_CONTACT = "contact jethro <jethro@explorethekingdom.co.uk> for more";

export type ChatModelId = "flash" | "opus" | "gpt" | "sonnet" | "pro";

export type ChatModelConfig = {
  id: ChatModelId;
  label: string;
  providerModel: string;
  dailyLimit: number;
  toolStepLimit: number;
  toolTemperature: number;
  toolOutputBudgetChars: number;
  minDataToolCallsForQuant: number;
  runEvidencePrefetchForQuant: boolean;
  enableMetadataRetryForQuant: boolean;
  maxMainToolStepsForQuant: number;
  maxPrefetchToolStepsForQuant: number;
  maxRepeatedToolCallsPerTurn: number;
  restrictQuantToolsForWeakModels: boolean;
};

export const CHAT_MODEL_CONFIGS: ChatModelConfig[] = [
  {
    id: "flash",
    label: "Gemini Flash",
    providerModel: "google/gemini-3.1-flash-lite-preview",
    dailyLimit: 80,
    toolStepLimit: 8,
    toolTemperature: 0.15,
    // Lowered from 30k to 15k: Flash drops the SSE stream when adapter
    // payloads are very large (e.g. central-London police_fetchCrimes can
    // exceed 350k chars before truncation). Tighter cap = more reliable
    // streaming on Gemini at the cost of fewer rows-per-call.
    toolOutputBudgetChars: 15_000,
    minDataToolCallsForQuant: 1,
    runEvidencePrefetchForQuant: true,
    enableMetadataRetryForQuant: true,
    maxMainToolStepsForQuant: 4,
    maxPrefetchToolStepsForQuant: 1,
    maxRepeatedToolCallsPerTurn: 2,
    restrictQuantToolsForWeakModels: true,
  },
  {
    id: "opus",
    label: "Opus 4.6",
    providerModel: "anthropic/claude-opus-4.6",
    dailyLimit: 50,
    toolStepLimit: 10,
    toolTemperature: 0.1,
    toolOutputBudgetChars: 36_000,
    minDataToolCallsForQuant: 1,
    runEvidencePrefetchForQuant: true,
    enableMetadataRetryForQuant: true,
    maxMainToolStepsForQuant: 8,
    maxPrefetchToolStepsForQuant: 3,
    maxRepeatedToolCallsPerTurn: 4,
    restrictQuantToolsForWeakModels: false,
  },
  {
    id: "gpt",
    label: "GPT-5.4",
    providerModel: "openai/gpt-5.4",
    dailyLimit: 50,
    toolStepLimit: 10,
    toolTemperature: 0.1,
    toolOutputBudgetChars: 34_000,
    minDataToolCallsForQuant: 2,
    runEvidencePrefetchForQuant: true,
    enableMetadataRetryForQuant: true,
    maxMainToolStepsForQuant: 6,
    maxPrefetchToolStepsForQuant: 2,
    maxRepeatedToolCallsPerTurn: 3,
    restrictQuantToolsForWeakModels: false,
  },
  {
    id: "sonnet",
    label: "Claude Sonnet",
    providerModel: "anthropic/claude-sonnet-4.6",
    dailyLimit: 50,
    toolStepLimit: 10,
    toolTemperature: 0.1,
    toolOutputBudgetChars: 34_000,
    minDataToolCallsForQuant: 1,
    runEvidencePrefetchForQuant: true,
    enableMetadataRetryForQuant: true,
    maxMainToolStepsForQuant: 5,
    maxPrefetchToolStepsForQuant: 2,
    maxRepeatedToolCallsPerTurn: 2,
    restrictQuantToolsForWeakModels: true,
  },
  {
    id: "pro",
    label: "Gemini Pro",
    providerModel: "google/gemini-2.5-pro",
    dailyLimit: 10,
    toolStepLimit: 9,
    toolTemperature: 0.12,
    toolOutputBudgetChars: 32_000,
    minDataToolCallsForQuant: 2,
    runEvidencePrefetchForQuant: true,
    enableMetadataRetryForQuant: true,
    maxMainToolStepsForQuant: 5,
    maxPrefetchToolStepsForQuant: 2,
    maxRepeatedToolCallsPerTurn: 2,
    restrictQuantToolsForWeakModels: false,
  },
];

export const DEFAULT_CHAT_MODEL_ID: ChatModelId = "flash";

export function getChatModelConfig(modelId?: string | null): ChatModelConfig {
  return CHAT_MODEL_CONFIGS.find((model) => model.id === modelId) ?? CHAT_MODEL_CONFIGS[0];
}
