import { Hono } from "hono";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import type { Env } from "../env.js";
import { getSupabaseAdmin, getUserFromRequest, json } from "../_lib/server.js";
import { loadAuthorizedMcpTools, parseJsonSafely, UK_POSTCODE_REGEX } from "../_lib/internals.js";
import { logWarn } from "../_lib/logger.js";
import { dbError } from "../_lib/validation.js";
import { createCouncilDeliberation, continueCouncilDeliberation } from "../_lib/council/handler.js";
import {
  parseCouncilCreateRequest,
  parseCouncilFollowUpRequest,
  parseCouncilInferScopeRequest,
} from "../_lib/council/schemas.js";
import type { CouncilDeliberation, CouncilResolvedGeography, CouncilScope } from "../_lib/council/types.js";
import { getChatModelConfig } from "../../src/shared/chat-models.js";

// ---------------------------------------------------------------------------
// Local helpers (not exported)
// ---------------------------------------------------------------------------

function isCouncilResolvedGeography(value: unknown): value is CouncilResolvedGeography {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.displayName === "string";
}

function isCouncilDeliberation(value: unknown): value is CouncilDeliberation {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.councilId === "string" &&
    typeof row.conversationId === "string" &&
    typeof row.issue === "string" &&
    Array.isArray(row.agents) &&
    Array.isArray(row.turns) &&
    typeof row.createdAt === "string"
  );
}

function extractAreaCandidate(text: string): string | null {
  const compact = text.replace(/\s+/g, " ").trim();
  const patterns = [
    /\bconstituency\s+([a-z0-9][a-z0-9\s'&-]{2,60}?)(?:\b(?:for|on|about|regarding|with|where|which)\b|[,.!?;]|$)/i,
    /\b(?:in|for|around|near)\s+([a-z][a-z\s'&-]{2,50}?)(?:\b(?:for|on|about|regarding|with|where|which)\b|[,.!?;]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = compact.match(pattern);
    const candidate = match?.[1]?.trim();
    if (!candidate) continue;
    if (["my area", "the area", "my constituency", "the constituency"].includes(candidate.toLowerCase())) continue;
    return candidate.replace(/[,.!?;]+$/, "");
  }
  return null;
}

function inferCouncilScopeDeterministic(text: string): CouncilScope {
  const postcodeMatch = text.match(UK_POSTCODE_REGEX);
  if (postcodeMatch?.[1]) {
    return { kind: "postcode", postcode: postcodeMatch[1].replace(/\s+/g, "").toUpperCase() };
  }
  const area = extractAreaCandidate(text);
  if (area) return { kind: "area", area };
  return { kind: "national" };
}

function normalizeCouncilScopeFromLlm(raw: unknown): CouncilScope | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const scopeKind = typeof row.scopeKind === "string" ? row.scopeKind.toLowerCase() : "";
  if (scopeKind === "postcode") {
    const postcode = typeof row.postcode === "string" ? row.postcode.trim() : "";
    if (!postcode) return null;
    return { kind: "postcode", postcode: postcode.replace(/\s+/g, "").toUpperCase() };
  }
  if (scopeKind === "area") {
    const area = typeof row.area === "string" ? row.area.trim() : "";
    if (!area) return null;
    return { kind: "area", area };
  }
  if (scopeKind === "national") {
    return { kind: "national" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const councilRoutes = new Hono<{ Bindings: Env }>();

// POST /infer-scope
councilRoutes.post("/infer-scope", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const parsed = parseCouncilInferScopeRequest(await c.req.raw.json());
  if ("error" in parsed) return json({ error: parsed.error }, 400);

  const deterministic = inferCouncilScopeDeterministic(parsed.data.text);
  if (deterministic.kind === "postcode") {
    return json({ scope: deterministic, source: "regex", confidence: "high" });
  }

  const openrouter = createOpenRouter({ apiKey: c.env.OPENROUTER_API_KEY });
  const selectedModel = getChatModelConfig(parsed.data.modelId);
  try {
    const result = await generateText({
      model: openrouter.chat(selectedModel.providerModel),
      temperature: 0,
      maxOutputTokens: 140,
      prompt: [
        "Extract geographic scope for UK civic council setup.",
        'Return ONLY JSON with fields: {"scopeKind":"postcode|area|national","postcode":"","area":"","confidence":"low|medium|high"}',
        "Rules:",
        "- If a UK postcode appears, choose postcode.",
        "- If a specific place or constituency appears, choose area and provide minimal area text.",
        "- If no reliable local place exists, choose national.",
        "",
        `User text: ${parsed.data.text}`,
      ].join("\n"),
    });
    const llmJson = parseJsonSafely(result.text);
    const normalized = normalizeCouncilScopeFromLlm(llmJson);
    if (normalized) {
      const confidence =
        llmJson && typeof llmJson === "object" && typeof (llmJson as Record<string, unknown>).confidence === "string"
          ? String((llmJson as Record<string, unknown>).confidence)
          : "medium";
      return json({ scope: normalized, source: "llm", confidence });
    }
  } catch (error) {
    logWarn("[api/council/infer-scope] LLM scope extraction failed", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return json({ scope: deterministic, source: "deterministic-fallback", confidence: "low" });
});

// POST /
councilRoutes.post("/", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const parsed = parseCouncilCreateRequest(await c.req.raw.json());
  if ("error" in parsed) return json({ error: parsed.error }, 400);

  const supabase = getSupabaseAdmin(c.env);
  const { data: conversation } = await supabase
    .from("uk_chat_conversations")
    .select("id")
    .eq("id", parsed.data.conversationId)
    .eq("user_id", user.id)
    .single();
  if (!conversation) return json({ error: "Conversation not found" }, 404);

  const toolLoad = await loadAuthorizedMcpTools({
    supabase,
    user,
    mcpToken: parsed.data.mcpToken,
    conversationId: parsed.data.conversationId,
    env: c.env,
  });
  if ("response" in toolLoad) return toolLoad.response;

  const openrouter = createOpenRouter({ apiKey: c.env.OPENROUTER_API_KEY });
  const selectedModel = getChatModelConfig(parsed.data.modelId);

  const draft = await createCouncilDeliberation({
    conversationId: parsed.data.conversationId,
    issue: parsed.data.issue,
    scope: parsed.data.scope,
    tools: toolLoad.tools,
    model: openrouter.chat(selectedModel.providerModel),
  });

  const councilId = crypto.randomUUID();
  const { error: insertCouncilError } = await supabase.from("uk_chat_councils").insert({
    id: councilId,
    conversation_id: draft.conversationId,
    user_id: user.id,
    issue: draft.issue,
    scope: draft.resolvedGeography.scope,
    resolved_geography: draft.resolvedGeography,
    routing: draft.routing,
    agents: draft.agents,
    resolution: draft.resolution,
    created_at: draft.createdAt,
    updated_at: draft.createdAt,
  });
  if (insertCouncilError) return dbError(insertCouncilError, { context: "api/council POST council", publicMessage: "Failed to create council" });

  const { error: insertTurnsError } = await supabase.from("uk_chat_council_turns").insert({
    council_id: councilId,
    turns: draft.turns,
    source: "initial",
    created_at: draft.createdAt,
  });
  if (insertTurnsError) return dbError(insertTurnsError, { context: "api/council turns insert", publicMessage: "Failed to save council turns" });

  const userParts = [
    {
      type: "text",
      text: `Create council (${parsed.data.scope.kind}) for ${draft.resolvedGeography.displayName}: ${draft.issue}`,
    },
  ];
  const assistantParts = [
    {
      type: "text",
      text: `Created a ${parsed.data.scope.kind === "national" ? "national" : "local"} council for ${draft.resolvedGeography.displayName}.`,
    },
    {
      type: "tool-council_deliberation",
      state: "output-available",
      output: {
        councilId,
        issue: draft.issue,
        routing: draft.routing,
        agents: draft.agents,
        turns: draft.turns,
        resolution: draft.resolution,
        scope: draft.resolvedGeography.scope,
        displayName: draft.resolvedGeography.displayName,
      },
      toolCallId: `council-${councilId}`,
    },
  ];

  await supabase.from("uk_chat_messages").insert([
    { conversation_id: draft.conversationId, role: "user", parts: userParts },
    { conversation_id: draft.conversationId, role: "assistant", parts: assistantParts },
  ]);
  await supabase
    .from("uk_chat_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", draft.conversationId)
    .eq("user_id", user.id);

  return json({
    councilId,
    issue: draft.issue,
    routing: draft.routing,
    agents: draft.agents,
    turns: draft.turns,
    resolution: draft.resolution,
    resolvedGeography: draft.resolvedGeography,
    createdAt: draft.createdAt,
  });
});

// POST /followup
councilRoutes.post("/followup", async (c) => {
  const user = await getUserFromRequest(c.req.raw, c.env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const parsed = parseCouncilFollowUpRequest(await c.req.raw.json());
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const supabase = getSupabaseAdmin(c.env);

  const { data: council, error: councilError } = await supabase
    .from("uk_chat_councils")
    .select("id,conversation_id,user_id,issue,routing,agents,resolved_geography,resolution")
    .eq("id", parsed.data.councilId)
    .eq("user_id", user.id)
    .single();
  if (councilError || !council) return json({ error: "Council not found" }, 404);

  const { data: turnsRows } = await supabase
    .from("uk_chat_council_turns")
    .select("turns")
    .eq("council_id", parsed.data.councilId)
    .order("created_at", { ascending: true });
  const existingTurns = (turnsRows ?? []).flatMap((row) => (Array.isArray(row.turns) ? row.turns : []));
  if (!isCouncilResolvedGeography(council.resolved_geography)) return json({ error: "Council geography is invalid." }, 500);

  const toolLoad = await loadAuthorizedMcpTools({
    supabase,
    user,
    mcpToken: parsed.data.mcpToken,
    conversationId: council.conversation_id,
    env: c.env,
  });
  if ("response" in toolLoad) return toolLoad.response;

  const openrouter = createOpenRouter({ apiKey: c.env.OPENROUTER_API_KEY });
  const selectedModel = getChatModelConfig(parsed.data.modelId);

  const next = await continueCouncilDeliberation({
    model: openrouter.chat(selectedModel.providerModel),
    issue: council.issue,
    followUp: parsed.data.followUp,
    routing: council.routing as CouncilDeliberation["routing"],
    agents: Array.isArray(council.agents) ? (council.agents as CouncilDeliberation["agents"]) : [],
    resolvedGeography: council.resolved_geography,
    existingTurns: existingTurns as CouncilDeliberation["turns"],
  });

  const now = new Date().toISOString();
  const { error: insertTurnsError } = await supabase.from("uk_chat_council_turns").insert({
    council_id: parsed.data.councilId,
    turns: next.turns,
    source: "follow_up",
    created_at: now,
  });
  if (insertTurnsError) return dbError(insertTurnsError, { context: "api/council turns insert", publicMessage: "Failed to save council turns" });

  const { error: updateCouncilError } = await supabase
    .from("uk_chat_councils")
    .update({ resolution: next.resolution, updated_at: now })
    .eq("id", parsed.data.councilId)
    .eq("user_id", user.id);
  if (updateCouncilError) return dbError(updateCouncilError, { context: "api/council followup update", publicMessage: "Failed to update council" });

  const assistantPayload = {
    councilId: parsed.data.councilId,
    issue: council.issue,
    routing: council.routing,
    agents: council.agents,
    turns: next.turns,
    resolution: next.resolution,
    scope: council.resolved_geography.scope,
    displayName: council.resolved_geography.displayName,
  };
  await supabase.from("uk_chat_messages").insert([
    { conversation_id: council.conversation_id, role: "user", parts: [{ type: "text", text: parsed.data.followUp }] },
    {
      conversation_id: council.conversation_id,
      role: "assistant",
      parts: [
        { type: "text", text: "Updated council deliberation with your follow-up." },
        {
          type: "tool-council_deliberation",
          state: "output-available",
          output: assistantPayload,
          toolCallId: `council-followup-${parsed.data.councilId}`,
        },
      ],
    },
  ]);
  await supabase
    .from("uk_chat_conversations")
    .update({ updated_at: now })
    .eq("id", council.conversation_id)
    .eq("user_id", user.id);

  return json(assistantPayload);
});
