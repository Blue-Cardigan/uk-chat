-- Drop the email_gate.pending_mcp_token cache column.
-- The MCP token issuer at xtk-mcp is now idempotent and authoritative; the
-- profile cache (uk_chat_profiles.mcp_token_encrypted) is refreshed from the
-- issuer on demand. Caching tokens in email_gate caused drift across apps
-- sharing this Supabase project.

alter table public.uk_chat_email_gate
  drop column if exists pending_mcp_token;
