import type { CouncilCreateRequest, CouncilFollowUpRequest, CouncilScope } from "./types.js";
type CouncilNation = "uk" | "england" | "scotland" | "wales" | "northern_ireland";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseScope(raw: unknown): CouncilScope | null {
  if (!isRecord(raw)) return null;
  const kind = asTrimmedString(raw.kind);
  if (kind === "postcode") {
    const postcode = asTrimmedString(raw.postcode);
    if (!postcode) return null;
    return { kind: "postcode", postcode };
  }
  if (kind === "area") {
    const area = asTrimmedString(raw.area);
    if (!area) return null;
    return { kind: "area", area };
  }
  if (kind === "national") {
    const nation = asTrimmedString(raw.nation).toLowerCase();
    if (!nation) return { kind: "national" };
    if (!["uk", "england", "scotland", "wales", "northern_ireland"].includes(nation)) return null;
    return { kind: "national", nation: nation as CouncilNation };
  }
  return null;
}

export function parseCouncilCreateRequest(body: unknown): { ok: true; data: CouncilCreateRequest } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "Request body must be an object." };
  const conversationId = asTrimmedString(body.conversationId);
  const issue = asTrimmedString(body.issue);
  const scope = parseScope(body.scope);
  const modelId = asTrimmedString(body.modelId) || null;
  const mcpToken = asTrimmedString(body.mcpToken) || null;
  if (!conversationId) return { ok: false, error: "conversationId is required." };
  if (issue.length < 8 || issue.length > 1500) return { ok: false, error: "issue must be between 8 and 1500 characters." };
  if (!scope) return { ok: false, error: "scope must be postcode, area, or national." };
  return {
    ok: true,
    data: {
      conversationId,
      issue,
      scope,
      modelId,
      mcpToken,
    },
  };
}

export function parseCouncilFollowUpRequest(body: unknown): { ok: true; data: CouncilFollowUpRequest } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "Request body must be an object." };
  const councilId = asTrimmedString(body.councilId);
  const followUp = asTrimmedString(body.followUp);
  const modelId = asTrimmedString(body.modelId) || null;
  const mcpToken = asTrimmedString(body.mcpToken) || null;
  if (!councilId) return { ok: false, error: "councilId is required." };
  if (followUp.length < 3 || followUp.length > 1500) return { ok: false, error: "followUp must be between 3 and 1500 characters." };
  return {
    ok: true,
    data: {
      councilId,
      followUp,
      modelId,
      mcpToken,
    },
  };
}

