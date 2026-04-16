export type ThemePreference = "system" | "light" | "dark";

export type ChatConversation = {
  id: string;
  title: string;
  starred: boolean;
  is_public: boolean;
  share_token: string | null;
  share_expires_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatMessageRecord = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  parts: unknown[];
  created_at: string;
};

// AI SDK message parts have an open shape (text, tool-*, data-*, and others).
// We keep the index signature rather than a discriminated union because any
// narrowed union member would be subsumed by the fallback, defeating the
// point. Consumers narrow via explicit `part.type === "..."` checks.
export type MessagePart = { type: string; [key: string]: unknown };

export type PersistedMessage = {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  created_at: string;
};

export type ChartSpec = {
  type: "line" | "bar" | "scatter" | "area" | "pie" | "table";
  title: string;
  xField: string;
  yFields: string[];
  labelField?: string;
  groupField?: string;
  data: Record<string, unknown>[];
  sources?: string[];
  note?: string;
};

export type VizPayload = {
  id: string;
  toolName: string;
  data: unknown;
  title?: string;
  chartSpec?: ChartSpec;
  conversationId?: string;
  messageId?: string;
  createdAt?: string;
};

export type ArtifactLibraryConversation = {
  id: string;
  title: string;
  updated_at: string;
  artifacts: VizPayload[];
};

export type ArtifactLibrary = {
  conversations: ArtifactLibraryConversation[];
};

export type UserProfile = {
  id: string;
  display_name: string | null;
  mcp_token: string | null;
  theme_preference: ThemePreference;
};

export type SuggestedPrompt = {
  id: string;
  label: string;
};
