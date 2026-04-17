export type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  OPENROUTER_API_KEY: string;
  MCP_SERVER_URL: string;
  MCP_TOKEN_ISSUE_URL: string;
  MCP_TOKEN_ISSUE_SECRET: string;
  MCP_TOKEN_ENCRYPTION_KEY: string;
  ADMIN_EMAIL: string;
  APP_URL: string;
  INVITE_APP_URL: string;
  ALLOWED_EMAIL_DOMAINS: string;
  RESEND_API_KEY: string;
  RESEND_WEBHOOK_SECRET: string;
  RESEND_FROM_EMAIL: string;
  CRON_SECRET: string;
  DATA_RETENTION_DAYS: string;
  SOFT_DELETE_GRACE_DAYS?: string;
  AUDIT_LOG_RETENTION_DAYS?: string;
  COUNCIL_NATIONAL_SOURCE_PREFERENCE: string;
  COUNCIL_NATIONAL_WHATGOV_MPS_TABLE: string;
  COUNCIL_NATIONAL_WHATGOV_DEBATES_TABLE: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  ADMIN_API_URL?: string;
  CHAT_LIMITER?: RateLimiter;
  AUTH_LIMITER?: RateLimiter;
  SHARE_LIMITER?: RateLimiter;
};

export type RateLimiter = {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
};
