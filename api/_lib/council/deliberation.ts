import { generateText } from "ai";
import { buildCouncilSystemPrompt, buildCouncilUserPrompt, COUNCIL_DELIBERATION_SCHEMA, normalizeCouncilResolution, normalizeCouncilTurns } from "./deliberation-protocol.js";
import type { CouncilAgent, CouncilDeliberationTurn, CouncilResolution, CouncilRoutingDecision } from "./types.js";

function tryExtractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const blockMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```\s*([\s\S]*?)```/i);
  if (blockMatch?.[1]) {
    try {
      return JSON.parse(blockMatch[1].trim());
    } catch {
      // continue
    }
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    const candidate = trimmed.slice(objectStart, objectEnd + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // ignore
    }
  }
  return null;
}

export async function generateCouncilDeliberation(args: {
  model: unknown;
  issue: string;
  contextName: string;
  routing: CouncilRoutingDecision;
  agents: CouncilAgent[];
  followUp?: string | null;
}): Promise<{ turns: CouncilDeliberationTurn[]; resolution: CouncilResolution; rawJson: unknown }> {
  const prompt = buildCouncilUserPrompt({
    issue: args.issue,
    contextName: args.contextName,
    followUp: args.followUp,
  });
  const system = buildCouncilSystemPrompt({
    routing: args.routing,
    agents: args.agents,
    maxRounds: args.followUp ? 2 : 3,
  });

  const result = await generateText({
    model: args.model as Parameters<typeof generateText>[0]["model"],
    system,
    prompt: [
      prompt,
      "",
      "Return strict JSON with keys: turns, resolution.",
      `Schema reference: ${JSON.stringify(COUNCIL_DELIBERATION_SCHEMA)}`,
    ].join("\n"),
    temperature: 0.2,
    maxOutputTokens: 1800,
  });

  const parsed = tryExtractJson(result.text);
  const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const turns = normalizeCouncilTurns(root.turns);
  const resolution = normalizeCouncilResolution(root.resolution);
  return { turns, resolution, rawJson: parsed };
}

