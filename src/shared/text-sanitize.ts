const PRIOR_TOOL_TAG_RE = /<prior_tool\b[^>]*>[\s\S]*?<\/prior_tool>/g;
const LEGACY_TOOL_HEADER_RE = /\[Tool(?:Result)?\s+[^\]]+\]/g;
const ORPHANED_PIPE_RE = /^\s*\|\s*(?:output|input|args|result|state)=\S[^\n]*$/gm;
const EXCESS_BLANK_LINES_RE = /\n{3,}/g;

export function stripToolContextEchoes(text: string): string {
  if (!text) return text;

  let cleaned = text;

  if (cleaned.includes("<prior_tool")) {
    cleaned = cleaned.replace(PRIOR_TOOL_TAG_RE, "");
  }

  if (/\[Tool(?:Result)?\s/.test(cleaned)) {
    cleaned = cleaned.replace(LEGACY_TOOL_HEADER_RE, "");
  }

  cleaned = cleaned.replace(ORPHANED_PIPE_RE, "");
  cleaned = cleaned.replace(EXCESS_BLANK_LINES_RE, "\n\n");

  return cleaned.trim();
}
