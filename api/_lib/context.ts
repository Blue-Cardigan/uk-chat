type CompactUiMessage = {
  role: "user" | "assistant" | "system";
  parts: Array<Record<string, unknown>>;
};

const MAX_MODEL_CONTEXT_MESSAGES = 12;
const MAX_MODEL_MESSAGE_PARTS = 12;
const MAX_MODEL_TEXT_PART_CHARS = 4_000;
const MAX_TOOL_PART_JSON_CHARS = 1_600;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated for context window]`;
}

function compactToolPayload(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= MAX_TOOL_PART_JSON_CHARS) return serialized;
    return `${serialized.slice(0, MAX_TOOL_PART_JSON_CHARS)}...[truncated]`;
  } catch {
    return "[tool payload unavailable]";
  }
}

function normalizeRole(role: unknown): "user" | "assistant" | "system" {
  if (role === "assistant" || role === "system") return role;
  return "user";
}

function compactPart(part: unknown): Record<string, unknown> | null {
  if (!isRecord(part) || typeof part.type !== "string") return null;

  if (part.type === "text") {
    if (typeof part.text !== "string" || !part.text.trim()) return null;
    return { ...part, text: truncateText(part.text, MAX_MODEL_TEXT_PART_CHARS) };
  }

  if (part.type === "reasoning") return null;

  if (part.type === "tool-invocation") {
    const toolName = typeof part.toolName === "string" ? part.toolName : "tool";
    const state = typeof part.state === "string" ? part.state : "unknown";
    const argsSummary = part.args !== undefined ? compactToolPayload(part.args) : undefined;
    const resultSummary = part.result !== undefined ? compactToolPayload(part.result) : undefined;
    const inner = [
      `state=${state}`,
      argsSummary ? `args=${argsSummary}` : null,
      resultSummary ? `result=${resultSummary}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    return {
      type: "text",
      text: `<prior_tool name="${toolName}">${inner}</prior_tool>`,
    };
  }

  if (part.type.startsWith("tool-")) {
    const toolName = part.type.slice("tool-".length) || "tool";
    const outputSummary = part.output !== undefined ? compactToolPayload(part.output) : undefined;
    const inputSummary = part.input !== undefined ? compactToolPayload(part.input) : undefined;
    const inner = [
      inputSummary ? `input=${inputSummary}` : null,
      outputSummary ? `output=${outputSummary}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    return {
      type: "text",
      text: `<prior_tool name="${toolName}">${inner}</prior_tool>`,
    };
  }

  // Keep other structured parts as-is so model still has metadata/document context.
  return part;
}

export function compactMessagesForModel(messages: unknown): CompactUiMessage[] {
  if (!Array.isArray(messages)) return [];

  const compacted: CompactUiMessage[] = [];
  for (const message of messages.slice(-MAX_MODEL_CONTEXT_MESSAGES)) {
    if (!isRecord(message)) continue;
    const role = normalizeRole(message.role);
    const rawParts = Array.isArray(message.parts) ? message.parts : [];
    const parts = rawParts
      .slice(0, MAX_MODEL_MESSAGE_PARTS)
      .map((part) => compactPart(part))
      .filter((part): part is Record<string, unknown> => part !== null);

    if (parts.length === 0 && typeof message.content === "string" && message.content.trim()) {
      parts.push({ type: "text", text: truncateText(message.content, MAX_MODEL_TEXT_PART_CHARS) });
    }

    if (parts.length === 0) continue;
    compacted.push({ role, parts });
  }

  return compacted;
}

