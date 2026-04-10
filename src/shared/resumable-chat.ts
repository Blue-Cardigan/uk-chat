export type ResumableChatStatus = "in_progress" | "completed" | "failed";

export type ResumableChatCreateRequest = {
  conversationId: string;
  mcpToken?: string | null;
  modelId?: string | null;
  documents?: unknown;
  artifactContext?: Array<{
    id?: string;
    conversationId?: string;
    messageId?: string;
    toolName?: string;
    title?: string;
    data?: unknown;
    chartSpec?: unknown;
  }>;
  messages?: Array<{ role?: string; parts?: unknown[] }>;
  idempotencyKey?: string | null;
};

export type ResumableChatContinueRequest = {
  mcpToken?: string | null;
  idempotencyKey?: string | null;
};

export type ResumableChatJobPayload = {
  id: string;
  conversationId: string;
  status: ResumableChatStatus;
  completedSlices: number;
  maxSlices: number;
  assistantParts: Array<{ type: string; [key: string]: unknown }> | null;
  lastError: string | null;
  updatedAt: string;
};
