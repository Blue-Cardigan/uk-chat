import { useEffect, useMemo, useRef } from "react";
import type { UIMessage } from "ai";
import { isVizArtifactCandidate, normalizeVizToolName } from "@/lib/viz-helpers";
import { buildChartSpecFromVizHint, isChartSpec } from "@/lib/viz-data-parser";
import type { ChartSpec, MessagePart } from "@/lib/types";

function stableStringify(value: unknown): string {
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hashString(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

type FinalizedToolPart = {
  messageId: string;
  toolName: string;
  toolCallId: string | undefined;
  partType: string;
  output: unknown;
};

function collectFinalizedToolParts(messages: UIMessage[]): FinalizedToolPart[] {
  const out: FinalizedToolPart[] = [];
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.parts)) continue;
    for (const part of message.parts as MessagePart[]) {
      if (part.type === "tool-invocation") {
        const inv = (part as { toolInvocation?: { toolName: string; toolCallId: string; state: string; result?: unknown } }).toolInvocation;
        if (!inv || inv.state !== "result" || inv.result == null) continue;
        out.push({
          messageId: message.id,
          toolName: inv.toolName,
          toolCallId: inv.toolCallId,
          partType: "tool-invocation",
          output: inv.result,
        });
      } else if (part.type.startsWith("tool-")) {
        if (part.state !== "output-available" || !("output" in part) || part.output == null) continue;
        out.push({
          messageId: message.id,
          toolName: part.type.replace("tool-", ""),
          toolCallId: typeof part.toolCallId === "string" ? part.toolCallId : undefined,
          partType: part.type,
          output: part.output,
        });
      }
    }
  }
  return out;
}

export type ArtifactPushPayload = {
  id: string;
  toolName: string;
  data: unknown;
  title: string;
  chartSpec?: ChartSpec;
  conversationId?: string;
  messageId: string;
};

export function useArtifactExtractor(params: {
  messages: UIMessage[];
  conversationId: string | null;
  onArtifact: (payload: ArtifactPushPayload) => void;
}): { resetArtifactTracking: () => void } {
  const { messages, conversationId, onArtifact } = params;
  const pushedArtifactKeysRef = useRef<Set<string>>(new Set());
  const artifactSignaturesRef = useRef<Map<string, string>>(new Map());
  const onArtifactRef = useRef(onArtifact);
  onArtifactRef.current = onArtifact;

  // Collect finalized tool parts once per render. The digest keys the scan
  // effect on tool-result arrivals only, so streaming text tokens don't
  // re-trigger extraction.
  const finalizedParts = useMemo(() => collectFinalizedToolParts(messages), [messages]);
  const toolDigest = useMemo(
    () => finalizedParts.map((p) => `${p.messageId}:${p.partType}:${p.toolCallId ?? "?"}`).join("|"),
    [finalizedParts],
  );
  const finalizedPartsRef = useRef(finalizedParts);
  finalizedPartsRef.current = finalizedParts;

  useEffect(() => {
    for (const { messageId, toolName, toolCallId, output } of finalizedPartsRef.current) {
      if (!isVizArtifactCandidate(toolName, output)) continue;
      const normalizedToolName = normalizeVizToolName(toolName);
      const chartSpec: ChartSpec | null =
        normalizedToolName === "create_chart" && isChartSpec(output)
          ? (output as ChartSpec)
          : buildChartSpecFromVizHint(output);
      const fallbackId = `sig-${hashString(`${normalizedToolName}:${stableStringify(output).slice(0, 1200)}`)}`;
      const id = toolCallId ?? fallbackId;
      const artifactKey = `${messageId}:${normalizedToolName}:${id}`;
      const signature = `${stableStringify(output).slice(0, 12000)}|${stableStringify(chartSpec).slice(0, 12000)}`;
      if (pushedArtifactKeysRef.current.has(artifactKey) && artifactSignaturesRef.current.get(artifactKey) === signature) continue;
      pushedArtifactKeysRef.current.add(artifactKey);
      artifactSignaturesRef.current.set(artifactKey, signature);
      onArtifactRef.current({
        id: artifactKey,
        toolName: normalizedToolName,
        data: output,
        title: `Chart: ${normalizedToolName}`,
        chartSpec: chartSpec ?? undefined,
        conversationId: conversationId ?? undefined,
        messageId,
      });
    }
  }, [conversationId, toolDigest]);

  return {
    resetArtifactTracking: () => {
      pushedArtifactKeysRef.current.clear();
      artifactSignaturesRef.current.clear();
    },
  };
}
