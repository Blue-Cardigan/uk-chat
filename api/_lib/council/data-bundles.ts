import type { CouncillorRecord, CouncillorsBundleLike, CouncilResolvedGeography, LocalMpApiResponse } from "./types.js";

type ToolMap = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function callTool<T = unknown>(tools: ToolMap, name: string, args: Record<string, unknown>): Promise<T | null> {
  const tool = tools[name];
  if (!isRecord(tool) || typeof tool.execute !== "function") return null;
  try {
    const result = await (tool.execute as (input: Record<string, unknown>) => Promise<unknown>)(args);
    return result as T;
  } catch {
    return null;
  }
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> => isRecord(row));
}

function normalizeMemberRecord(member: Record<string, unknown>, contextName: string): LocalMpApiResponse {
  const name =
    (typeof member.name_display_as === "string" && member.name_display_as) ||
    (typeof member.name === "string" && member.name) ||
    "Representative MP";
  return {
    member: {
      name_display_as: name,
      party: typeof member.party === "string" ? member.party : null,
      constituency: typeof member.constituency === "string" ? member.constituency : contextName,
      portrait_url: typeof member.portrait_url === "string" ? member.portrait_url : null,
      thumbnail_url: typeof member.thumbnail_url === "string" ? member.thumbnail_url : null,
      contact: [],
    },
    committee_memberships: [],
    extras: { focus_areas: [] },
  };
}

export async function fetchLocalMpBundle(tools: ToolMap, geography: CouncilResolvedGeography): Promise<LocalMpApiResponse | null> {
  if (geography.scope.kind === "national") return null;
  const lookupArgsCandidates: Array<Record<string, unknown>> = [];
  if (geography.postcode) lookupArgsCandidates.push({ postcode: geography.postcode });
  if (geography.constituencyCode) lookupArgsCandidates.push({ constituency_code: geography.constituencyCode });
  if (geography.constituencyName) lookupArgsCandidates.push({ constituency: geography.constituencyName });

  for (const args of lookupArgsCandidates) {
    const raw = await callTool<unknown>(tools, "parliament_fetchMembers", args);
    if (!raw) continue;
    if (isRecord(raw) && isRecord(raw.member)) return raw as LocalMpApiResponse;
    if (Array.isArray(raw)) {
      const first = asArray(raw)[0];
      if (first) return normalizeMemberRecord(first, geography.displayName);
    }
    if (isRecord(raw) && Array.isArray(raw.members)) {
      const first = asArray(raw.members)[0];
      if (first) return normalizeMemberRecord(first, geography.displayName);
    }
  }
  return null;
}

export async function fetchCouncilCouncillorsBundle(tools: ToolMap, geography: CouncilResolvedGeography): Promise<CouncillorsBundleLike | null> {
  if (geography.scope.kind === "national") return null;
  const queryCandidates: Array<Record<string, unknown>> = [];
  if (geography.postcode) queryCandidates.push({ postcode: geography.postcode });
  if (geography.localAuthorityCode) queryCandidates.push({ ladCode: geography.localAuthorityCode });
  if (geography.localAuthorityName) queryCandidates.push({ council: geography.localAuthorityName });
  if (geography.constituencyName) queryCandidates.push({ query: geography.constituencyName });

  for (const args of queryCandidates) {
    const raw = await callTool<unknown>(tools, "councillors_search", args);
    if (!raw) continue;
    if (isRecord(raw) && Array.isArray(raw.matched_councils)) {
      return raw as CouncillorsBundleLike;
    }
    if (Array.isArray(raw)) {
      const councillors = asArray(raw).map((row) => row as unknown as CouncillorRecord);
      return {
        matched_councils: [
          {
            council: geography.localAuthorityName ?? geography.displayName,
            councillors,
          },
        ],
      };
    }
  }
  return null;
}

export async function fetchNationalMpRepresentativeBundle(tools: ToolMap, nation: string | null): Promise<LocalMpApiResponse[]> {
  const argsCandidates: Array<Record<string, unknown>> = [
    { chamber: "Commons", limit: 8 },
    { house: "Commons", limit: 8 },
    { nation: nation ?? "uk", limit: 8 },
  ];
  for (const args of argsCandidates) {
    const raw = await callTool<unknown>(tools, "parliament_fetchMembers", args);
    if (!raw) continue;
    if (Array.isArray(raw)) {
      const rows = asArray(raw).slice(0, 8);
      if (rows.length > 0) return rows.map((row) => normalizeMemberRecord(row, "United Kingdom"));
    }
    if (isRecord(raw) && Array.isArray(raw.members)) {
      const rows = asArray(raw.members).slice(0, 8);
      if (rows.length > 0) return rows.map((row) => normalizeMemberRecord(row, "United Kingdom"));
    }
  }

  // Fallback so Council Mode remains functional even if tools fail.
  return [
    { member: { name_display_as: "Representative MP 1", party: null, constituency: "UK", contact: [] }, committee_memberships: [] },
    { member: { name_display_as: "Representative MP 2", party: null, constituency: "UK", contact: [] }, committee_memberships: [] },
    { member: { name_display_as: "Representative MP 3", party: null, constituency: "UK", contact: [] }, committee_memberships: [] },
  ];
}

