export type ThemePreference = "system" | "light" | "dark";

export type ChatConversation = {
  id: string;
  title: string;
  starred: boolean;
  is_public: boolean;
  share_token: string | null;
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

export type VizPayload = {
  id: string;
  toolName: string;
  data: unknown;
  title?: string;
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
