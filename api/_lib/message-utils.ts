import { compactMessagesForModel as compactUiMessagesForModel } from "./context.js";
import { isRecord } from "../../src/shared/type-guards.js";
import type { CompactModelMessage, PersistedMessagePart } from "./internals.js";
import { stripToolContextEchoes } from "../../src/shared/text-sanitize.js";
import {
  MAX_TOOL_OUTPUT_ARRAY_ITEMS,
  MAX_TOOL_OUTPUT_DEPTH,
  MAX_TOOL_OUTPUT_OBJECT_KEYS,
  MAX_TOOL_OUTPUT_STRING,
} from "./tool-output-limits.js";

export function compactToolOutputForModel(value: unknown, depth = 0): unknown {
  if (depth > MAX_TOOL_OUTPUT_DEPTH) return "[truncated: depth]";

  if (typeof value === "string") {
    if (value.length <= MAX_TOOL_OUTPUT_STRING) return value;
    return `${value.slice(0, MAX_TOOL_OUTPUT_STRING)}\n\n[truncated for model context]`;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;

  if (Array.isArray(value)) {
    const compacted = value.slice(0, MAX_TOOL_OUTPUT_ARRAY_ITEMS).map((item) => compactToolOutputForModel(item, depth + 1));
    if (value.length > MAX_TOOL_OUTPUT_ARRAY_ITEMS) {
      compacted.push(`[truncated: ${value.length - MAX_TOOL_OUTPUT_ARRAY_ITEMS} more items]`);
    }
    return compacted;
  }

  if (!isRecord(value)) return value;

  const entries = Object.entries(value);
  const compactedObject: Record<string, unknown> = {};
  for (const [index, [key, entry]] of entries.entries()) {
    if (index >= MAX_TOOL_OUTPUT_OBJECT_KEYS) {
      compactedObject.__truncated__ = `${entries.length - MAX_TOOL_OUTPUT_OBJECT_KEYS} more keys omitted`;
      break;
    }
    compactedObject[key] = compactToolOutputForModel(entry, depth + 1);
  }
  return compactedObject;
}

export function compactMessagesForModel(messages: unknown): CompactModelMessage[] {
  const compacted = compactUiMessagesForModel(messages);
  return compacted.map((message) => {
    const content = message.parts
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n\n")
      .trim();
    return { role: message.role, content };
  });
}

export function sanitizeToolName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const normalized = name.trim();
  if (!normalized) return null;
  return normalized.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

export function extractPartsFromResponseMessage(
  message: unknown,
  resolveToolName?: (name: string) => string,
): PersistedMessagePart[] {
  if (!isRecord(message)) return [];

  const directParts = message.parts;
  if (Array.isArray(directParts)) {
    return directParts.filter((part): part is PersistedMessagePart => isRecord(part) && typeof part.type === "string");
  }

  const content = message.content;
  if (!Array.isArray(content)) return [];

  const toolIndex = new Map<string, PersistedMessagePart>();
  const parts: PersistedMessagePart[] = [];

  for (const segment of content) {
    if (!isRecord(segment) || typeof segment.type !== "string") continue;

    if (segment.type === "text" && typeof segment.text === "string") {
      const cleaned = stripToolContextEchoes(segment.text);
      if (cleaned) {
        parts.push({ type: "text", text: cleaned });
      }
      continue;
    }

    if (segment.type === "reasoning" && typeof segment.text === "string") {
      parts.push({ type: "reasoning", text: segment.text });
      continue;
    }

    if (segment.type === "tool-call") {
      const resolvedName = typeof segment.toolName === "string" ? resolveToolName?.(segment.toolName) ?? segment.toolName : segment.toolName;
      const toolName = sanitizeToolName(resolvedName);
      if (!toolName) continue;
      const callId = (segment.toolCallId as string) ?? null;
      const part: PersistedMessagePart = {
        type: `tool-${toolName}`,
        state: "input-available",
        input: segment.input ?? null,
        toolCallId: callId,
      };
      parts.push(part);
      if (callId) toolIndex.set(callId, part);
      continue;
    }

    if (segment.type === "tool-result") {
      const resolvedName = typeof segment.toolName === "string" ? resolveToolName?.(segment.toolName) ?? segment.toolName : segment.toolName;
      const toolName = sanitizeToolName(resolvedName);
      if (!toolName) continue;
      const callId = (segment.toolCallId as string) ?? null;
      const existing = callId ? toolIndex.get(callId) : undefined;
      if (existing) {
        existing.state = "output-available";
        existing.output = segment.output ?? null;
      } else {
        parts.push({
          type: `tool-${toolName}`,
          state: "output-available",
          output: segment.output ?? null,
          toolCallId: callId,
        });
      }
      continue;
    }

    parts.push(segment as PersistedMessagePart);
  }
  return parts;
}

export function mergeToolCallsAndResultsIntoParts(
  parts: PersistedMessagePart[],
  event: unknown,
  resolveToolName?: (name: string) => string,
): PersistedMessagePart[] {
  if (!isRecord(event)) return parts;

  const merged = [...parts];
  const toolIndex = new Map<string, PersistedMessagePart>();
  const existingSignatures = new Set<string>();

  for (const [index, part] of merged.entries()) {
    if (!isRecord(part) || typeof part.type !== "string" || !part.type.startsWith("tool-")) continue;
    const callId = typeof part.toolCallId === "string" ? part.toolCallId : null;
    if (callId) toolIndex.set(callId, part);
    existingSignatures.add(`${part.type}:${callId ?? `idx-${index}`}`);
  }

  const toolCalls = Array.isArray(event.toolCalls) ? event.toolCalls : [];
  for (const call of toolCalls) {
    if (!isRecord(call)) continue;
    const resolvedName = typeof call.toolName === "string" ? resolveToolName?.(call.toolName) ?? call.toolName : call.toolName;
    const toolName = sanitizeToolName(resolvedName);
    if (!toolName) continue;
    const callId = (call.toolCallId as string) ?? null;
    const signature = `tool-${toolName}:${callId ?? "no-call-id"}`;
    if (existingSignatures.has(signature)) continue;
    const part: PersistedMessagePart = {
      type: `tool-${toolName}`,
      state: "input-available",
      input: call.input ?? null,
      toolCallId: callId,
    };
    merged.push(part);
    if (callId) toolIndex.set(callId, part);
    existingSignatures.add(signature);
  }

  const toolResults = Array.isArray(event.toolResults) ? event.toolResults : [];
  for (const result of toolResults) {
    if (!isRecord(result)) continue;
    const resolvedName = typeof result.toolName === "string" ? resolveToolName?.(result.toolName) ?? result.toolName : result.toolName;
    const toolName = sanitizeToolName(resolvedName);
    if (!toolName) continue;
    const callId = (result.toolCallId as string) ?? null;
    const existing = callId ? toolIndex.get(callId) : undefined;
    if (existing) {
      existing.state = "output-available";
      existing.output = result.output ?? null;
      continue;
    }

    const signature = `tool-${toolName}:${callId ?? "no-call-id"}`;
    if (existingSignatures.has(signature)) continue;
    merged.push({
      type: `tool-${toolName}`,
      state: "output-available",
      output: result.output ?? null,
      toolCallId: callId,
    });
    existingSignatures.add(signature);
  }

  return merged;
}

export function buildAssistantPartsFromFinishEvent(
  event: unknown,
  resolveToolName?: (name: string) => string,
): PersistedMessagePart[] {
  if (!isRecord(event)) return [{ type: "text", text: "" }];

  const response = event.response;
  if (isRecord(response) && Array.isArray(response.messages)) {
    const assistantResponseMessage = [...response.messages]
      .reverse()
      .find((message) => isRecord(message) && message.role === "assistant");
    const responseParts = extractPartsFromResponseMessage(assistantResponseMessage, resolveToolName);
    if (responseParts.length > 0) {
      return mergeToolCallsAndResultsIntoParts(responseParts, event, resolveToolName);
    }
  }

  const text = typeof event.text === "string" ? event.text : "";
  const fallbackParts: PersistedMessagePart[] = [{ type: "text", text }];
  if (typeof event.reasoning === "string" && event.reasoning.trim()) {
    fallbackParts.push({ type: "reasoning", text: event.reasoning });
  }

  const fallbackToolIndex = new Map<string, PersistedMessagePart>();
  const toolCalls = Array.isArray(event.toolCalls) ? event.toolCalls : [];
  for (const call of toolCalls) {
    if (!isRecord(call)) continue;
    const resolvedName = typeof call.toolName === "string" ? resolveToolName?.(call.toolName) ?? call.toolName : call.toolName;
    const toolName = sanitizeToolName(resolvedName);
    if (!toolName) continue;
    const callId = (call.toolCallId as string) ?? null;
    const part: PersistedMessagePart = {
      type: `tool-${toolName}`,
      state: "input-available",
      input: call.input ?? null,
      toolCallId: callId,
    };
    fallbackParts.push(part);
    if (callId) fallbackToolIndex.set(callId, part);
  }

  const toolResults = Array.isArray(event.toolResults) ? event.toolResults : [];
  for (const result of toolResults) {
    if (!isRecord(result)) continue;
    const resolvedName = typeof result.toolName === "string" ? resolveToolName?.(result.toolName) ?? result.toolName : result.toolName;
    const toolName = sanitizeToolName(resolvedName);
    if (!toolName) continue;
    const callId = (result.toolCallId as string) ?? null;
    const existing = callId ? fallbackToolIndex.get(callId) : undefined;
    if (existing) {
      existing.state = "output-available";
      existing.output = result.output ?? null;
    } else {
      fallbackParts.push({
        type: `tool-${toolName}`,
        state: "output-available",
        output: result.output ?? null,
        toolCallId: callId,
      });
    }
  }

  return fallbackParts;
}

/**
 * When a model emits a complete `create_chart` tool call but its stream
 * terminates before the (synthetic, server-side) execute() result is
 * delivered through the AI SDK chunk stream, the orphan-pairing step below
 * marks the call with a synthesized error envelope. This recovery hook runs
 * BEFORE that pairing: if the orphan part already carries the model's full
 * input args, we just execute the synthetic tool ourselves. The chart was
 * always ours to render — losing it to a Gemini Flash streaming hiccup is
 * a UX regression we can avoid trivially.
 */
export function recoverOrphanCreateChart<T extends PersistedMessagePart>(
  parts: T[],
  toolName: string,
  execute: (input: unknown) => unknown,
): { parts: T[]; recoveredCount: number } {
  let recoveredCount = 0;
  const out = parts.map((part) => {
    if (!isRecord(part) || typeof part.type !== "string") return part;
    if (part.type !== `tool-${toolName}`) return part;
    if (part.state === "output-available") return part;
    const input = part.input;
    if (input === undefined || input === null) return part;
    try {
      const recovered = execute(input);
      recoveredCount += 1;
      return {
        ...part,
        state: "output-available",
        output: recovered,
      } as T;
    } catch {
      return part;
    }
  });
  return { parts: out, recoveredCount };
}

export function ensureToolResultsPaired(parts: PersistedMessagePart[]): {
  parts: PersistedMessagePart[];
  orphanCount: number;
} {
  let orphanCount = 0;
  const paired = parts.map((part) => {
    if (!isRecord(part) || typeof part.type !== "string" || !part.type.startsWith("tool-")) return part;
    if (part.state === "output-available") return part;
    orphanCount += 1;
    return {
      ...part,
      state: "output-available",
      output: {
        isError: true,
        error: "Tool execution did not produce a result before the stream ended.",
        synthesized: true,
      },
    };
  });
  return { parts: paired, orphanCount };
}

export function hasMeaningfulTextPart(parts: PersistedMessagePart[]): boolean {
  return parts.some(
    (part) =>
      isRecord(part) &&
      part.type === "text" &&
      typeof part.text === "string" &&
      part.text.trim().length > 0,
  );
}

export function hasAnyToolOutput(parts: PersistedMessagePart[]): boolean {
  return parts.some(
    (part) =>
      isRecord(part) &&
      typeof part.type === "string" &&
      part.type.startsWith("tool-") &&
      part.state === "output-available" &&
      part.output != null &&
      !(isRecord(part.output) && part.output.isError === true),
  );
}

export function isPersistedToolPart(part: unknown): part is PersistedMessagePart & { type: `tool-${string}` } {
  return isRecord(part) && typeof part.type === "string" && part.type.startsWith("tool-");
}

export function stringifyPersistedToolPayload(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

export function persistedToolPartSignature(part: PersistedMessagePart, fallbackIndex: number): string {
  const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : `idx-${fallbackIndex}`;
  const state = typeof part.state === "string" ? part.state : "";
  const input = stringifyPersistedToolPayload(part.input);
  const output = stringifyPersistedToolPayload(part.output);
  return `${part.type}:${toolCallId}:${state}:${input}:${output}`;
}

export function collectToolPartsFromMessages(messages: Array<{ role?: unknown; parts?: unknown }>): PersistedMessagePart[] {
  const collected: PersistedMessagePart[] = [];
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      if (!isPersistedToolPart(part)) continue;
      collected.push(part);
    }
  }
  return collected;
}
