import { useEffect, useRef } from "react";
import type { UIMessage } from "ai";
import { isVizArtifactCandidate, normalizeVizToolName } from "@/lib/viz-helpers";
import { buildChartSpecFromVizHint, isChartSpec } from "@/lib/viz-data-parser";
import type { ChartSpec } from "@/lib/types";

type Part = { type: string; [key: string]: unknown };

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

  useEffect(() => {
    for (const message of messages) {
      if (message.role !== "assistant" || !Array.isArray(message.parts)) continue;

      (message.parts as Part[]).forEach((part) => {
        let toolName: string | undefined;
        let toolCallId: string | undefined;
        let output: unknown;

        if (part.type === "tool-invocation") {
          const inv = (part as { toolInvocation?: { toolName: string; toolCallId: string; state: string; result?: unknown } }).toolInvocation;
          if (!inv || inv.state !== "result" || inv.result == null) return;
          toolName = inv.toolName;
          toolCallId = inv.toolCallId;
          output = inv.result;
        } else if (part.type.startsWith("tool-")) {
          if (part.state !== "output-available" || !("output" in part) || part.output == null) return;
          toolName = part.type.replace("tool-", "");
          toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : undefined;
          output = part.output;
        } else {
          return;
        }

        if (!toolName || !isVizArtifactCandidate(toolName, output)) return;
        const normalizedToolName = normalizeVizToolName(toolName);
        const chartSpec: ChartSpec | null =
          normalizedToolName === "create_chart" && isChartSpec(output)
            ? (output as ChartSpec)
            : buildChartSpecFromVizHint(output);
        const fallbackId = `sig-${hashString(`${normalizedToolName}:${stableStringify(output).slice(0, 1200)}`)}`;
        const id = toolCallId ?? fallbackId;
        const artifactKey = `${message.id}:${normalizedToolName}:${id}`;
        const signature = `${stableStringify(output).slice(0, 12000)}|${stableStringify(chartSpec).slice(0, 12000)}`;
        if (pushedArtifactKeysRef.current.has(artifactKey) && artifactSignaturesRef.current.get(artifactKey) === signature) return;
        pushedArtifactKeysRef.current.add(artifactKey);
        artifactSignaturesRef.current.set(artifactKey, signature);
        onArtifactRef.current({
          id: artifactKey,
          toolName: normalizedToolName,
          data: output,
          title: `Chart: ${normalizedToolName}`,
          chartSpec: chartSpec ?? undefined,
          conversationId: conversationId ?? undefined,
          messageId: message.id,
        });
      });
    }
  }, [conversationId, messages]);

  return {
    resetArtifactTracking: () => {
      pushedArtifactKeysRef.current.clear();
      artifactSignaturesRef.current.clear();
    },
  };
}
