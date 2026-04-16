import type { CouncillorRecord, CouncillorsBundleLike, CouncilResolvedGeography, LocalMpApiResponse } from "./types.js";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../server.js";
import { isRecord } from "../internals.js";

type ToolMap = Record<string, unknown>;

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

type NationalPartyTarget = {
  party: string;
  aliases: string[];
  focusAreas: string[];
  queryHints: string[];
};

type NationalCandidate = {
  name: string;
  party: string | null;
  constituency: string | null;
  portraitUrl: string | null;
  thumbnailUrl: string | null;
  memberId?: number | null;
};

type SourcePreference = "whatgov-first" | "api-first";
type CouncilSourceSettings = {
  sourcePreference: SourcePreference;
  whatGovMpsTable: string;
  whatGovDebatesTable: string;
};

const DEFAULT_WHATGOV_MPS_TABLE = "mps_uwhatgov";
const DEFAULT_WHATGOV_DEBATES_TABLE = "casual_debates_uwhatgov";

const DEFAULT_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "being",
  "could",
  "should",
  "would",
  "their",
  "there",
  "these",
  "those",
  "where",
  "which",
  "while",
  "local",
  "national",
  "issue",
  "strategy",
  "across",
]);

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function readEnv(key: string, env?: Partial<Env>): string | undefined {
  if (env && key in env) return (env as Record<string, string | undefined>)[key];
  const maybeProcess = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return maybeProcess.process?.env?.[key];
}

function getNationalSourcePreference(env?: Partial<Env>): SourcePreference {
  const raw = readEnv("COUNCIL_NATIONAL_SOURCE_PREFERENCE", env);
  return normalizeToken(raw ?? "") === "api first" || normalizeToken(raw ?? "") === "api-first" ? "api-first" : "whatgov-first";
}

function getSupabaseAdminSafe(env?: Env): ReturnType<typeof getSupabaseAdmin> | null {
  if (!env) return null;
  try {
    return getSupabaseAdmin(env);
  } catch {
    return null;
  }
}

function getSettingOverride(key: "COUNCIL_NATIONAL_WHATGOV_MPS_TABLE" | "COUNCIL_NATIONAL_WHATGOV_DEBATES_TABLE", env?: Partial<Env>): string | null {
  const raw = readEnv(key, env);
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

async function loadCouncilSourceSettings(env?: Env): Promise<CouncilSourceSettings> {
  const base: CouncilSourceSettings = {
    sourcePreference: getNationalSourcePreference(env),
    whatGovMpsTable: getSettingOverride("COUNCIL_NATIONAL_WHATGOV_MPS_TABLE", env) ?? DEFAULT_WHATGOV_MPS_TABLE,
    whatGovDebatesTable: getSettingOverride("COUNCIL_NATIONAL_WHATGOV_DEBATES_TABLE", env) ?? DEFAULT_WHATGOV_DEBATES_TABLE,
  };

  if (getSettingOverride("COUNCIL_NATIONAL_WHATGOV_MPS_TABLE", env) || getSettingOverride("COUNCIL_NATIONAL_WHATGOV_DEBATES_TABLE", env)) {
    return base;
  }

  const supabase = getSupabaseAdminSafe(env);
  if (!supabase) return base;

  const { data, error } = await supabase
    .from("system_settings")
    .select("key,value")
    .in("key", [
      "council_national_source_preference",
      "council_national_whatgov_mps_table",
      "council_national_whatgov_debates_table",
    ]);

  if (error || !Array.isArray(data)) return base;

  const settings = new Map<string, string>();
  for (const row of data as Array<Record<string, unknown>>) {
    const key = typeof row.key === "string" ? row.key : "";
    const value = typeof row.value === "string" ? row.value : "";
    if (key) settings.set(key, value);
  }

  const prefRaw = settings.get("council_national_source_preference");
  const prefNormalized = normalizeToken(prefRaw ?? "");
  const sourcePreference: SourcePreference = prefNormalized === "api first" || prefNormalized === "api-first" ? "api-first" : base.sourcePreference;

  const mpsTable = settings.get("council_national_whatgov_mps_table")?.trim() || base.whatGovMpsTable;
  const debatesTable = settings.get("council_national_whatgov_debates_table")?.trim() || base.whatGovDebatesTable;

  return {
    sourcePreference,
    whatGovMpsTable: mpsTable,
    whatGovDebatesTable: debatesTable,
  };
}

function nationCodePrefix(nation: string | null): string | null {
  const normalized = normalizeToken(nation ?? "uk");
  if (normalized.includes("england")) return "E";
  if (normalized.includes("scotland")) return "S";
  if (normalized.includes("wales")) return "W";
  if (normalized.includes("northern ireland")) return "N";
  return null;
}

function extractIssueKeywords(issue: string): string[] {
  const words = normalizeToken(issue)
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !DEFAULT_STOPWORDS.has(word));
  return [...new Set(words)].slice(0, 12);
}

function majorPartyTargetsForNation(nation: string | null): NationalPartyTarget[] {
  const normalizedNation = normalizeToken(nation ?? "uk");
  if (normalizedNation.includes("scotland")) {
    return [
      { party: "Scottish National Party", aliases: ["snp"], focusAreas: ["devolution", "public services", "fiscal framework"], queryHints: ["SNP"] },
      { party: "Labour", aliases: ["labour", "labour co-op"], focusAreas: ["health", "employment", "social care"], queryHints: ["Labour"] },
      { party: "Conservative", aliases: ["conservative", "tory"], focusAreas: ["taxation", "business", "public order"], queryHints: ["Conservative"] },
      { party: "Liberal Democrat", aliases: ["liberal democrat", "lib dem"], focusAreas: ["civil liberties", "education", "local government"], queryHints: ["Liberal Democrat"] },
      { party: "Scottish Green Party", aliases: ["scottish green", "green"], focusAreas: ["climate", "energy", "transport"], queryHints: ["Scottish Green"] },
    ];
  }
  if (normalizedNation.includes("wales")) {
    return [
      { party: "Labour", aliases: ["labour", "labour co-op"], focusAreas: ["nhs", "housing", "social policy"], queryHints: ["Labour"] },
      { party: "Conservative", aliases: ["conservative", "tory"], focusAreas: ["economy", "business", "crime"], queryHints: ["Conservative"] },
      { party: "Plaid Cymru", aliases: ["plaid cymru", "plaid"], focusAreas: ["welsh language", "devolution", "rural policy"], queryHints: ["Plaid Cymru"] },
      { party: "Liberal Democrat", aliases: ["liberal democrat", "lib dem"], focusAreas: ["care", "education", "constitutional reform"], queryHints: ["Liberal Democrat"] },
    ];
  }
  if (normalizedNation.includes("northern ireland")) {
    return [
      { party: "Democratic Unionist Party", aliases: ["dup"], focusAreas: ["constitutional affairs", "public services", "energy"], queryHints: ["DUP"] },
      { party: "Sinn Féin", aliases: ["sinn fein", "sinn féin"], focusAreas: ["cost of living", "housing", "health"], queryHints: ["Sinn Fein"] },
      { party: "Alliance Party", aliases: ["alliance"], focusAreas: ["justice", "integrated services", "governance reform"], queryHints: ["Alliance Party"] },
      { party: "Ulster Unionist Party", aliases: ["uup"], focusAreas: ["infrastructure", "health", "rural support"], queryHints: ["UUP"] },
      { party: "Social Democratic and Labour Party", aliases: ["sdlp"], focusAreas: ["social justice", "education", "local development"], queryHints: ["SDLP"] },
    ];
  }
  if (normalizedNation.includes("england")) {
    return [
      { party: "Labour", aliases: ["labour", "labour co-op"], focusAreas: ["health", "housing", "workers rights"], queryHints: ["Labour"] },
      { party: "Conservative", aliases: ["conservative", "tory"], focusAreas: ["tax", "business", "public order"], queryHints: ["Conservative"] },
      { party: "Liberal Democrat", aliases: ["liberal democrat", "lib dem"], focusAreas: ["care", "education", "constitutional reform"], queryHints: ["Liberal Democrat"] },
      { party: "Green", aliases: ["green", "green party"], focusAreas: ["climate", "clean air", "transport"], queryHints: ["Green Party"] },
      { party: "Reform UK", aliases: ["reform", "reform uk"], focusAreas: ["immigration", "tax", "governance"], queryHints: ["Reform UK"] },
    ];
  }
  return [
    { party: "Labour", aliases: ["labour", "labour co-op"], focusAreas: ["public services", "health", "housing"], queryHints: ["Labour"] },
    { party: "Conservative", aliases: ["conservative", "tory"], focusAreas: ["economy", "business", "public order"], queryHints: ["Conservative"] },
    { party: "Liberal Democrat", aliases: ["liberal democrat", "lib dem"], focusAreas: ["care", "education", "civil liberties"], queryHints: ["Liberal Democrat"] },
    { party: "Green", aliases: ["green", "green party"], focusAreas: ["climate", "energy", "transport"], queryHints: ["Green Party"] },
    { party: "Scottish National Party", aliases: ["snp"], focusAreas: ["devolution", "public spending", "constitutional affairs"], queryHints: ["SNP"] },
  ];
}

function normalizePartyLabel(value: string | null | undefined): string {
  if (!value) return "";
  return normalizeToken(value);
}

function partyMatches(candidateParty: string | null, target: NationalPartyTarget): boolean {
  const candidate = normalizePartyLabel(candidateParty);
  if (!candidate) return false;
  const options = [target.party, ...target.aliases].map(normalizePartyLabel);
  return options.some((option) => option.length > 0 && (candidate === option || candidate.includes(option)));
}

function extractMemberRows(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return asArray(raw);
  if (isRecord(raw) && isRecord(raw.member)) return [raw.member];
  if (isRecord(raw) && Array.isArray(raw.members)) return asArray(raw.members);
  return [];
}

function extractRowsFromSourcePayload(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return asArray(raw);
  if (!isRecord(raw)) return [];
  const candidates: unknown[] = [
    raw.results,
    raw.records,
    raw.items,
    raw.data,
    raw.members,
    isRecord(raw.response) ? raw.response.results : null,
    isRecord(raw.response) ? raw.response.items : null,
    isRecord(raw.payload) ? raw.payload.records : null,
    isRecord(raw.payload) ? raw.payload.items : null,
  ];
  for (const value of candidates) {
    if (Array.isArray(value)) return asArray(value);
  }
  return [];
}

function normalizeNationalCandidate(row: Record<string, unknown>): NationalCandidate | null {
  const name =
    (typeof row.name_display_as === "string" && row.name_display_as.trim()) ||
    (typeof row.name === "string" && row.name.trim()) ||
    "";
  if (!name) return null;
  return {
    name,
    party: typeof row.party === "string" ? row.party : null,
    constituency: typeof row.constituency === "string" ? row.constituency : null,
    portraitUrl: typeof row.portrait_url === "string" ? row.portrait_url : null,
    thumbnailUrl: typeof row.thumbnail_url === "string" ? row.thumbnail_url : null,
    memberId: typeof row.member_id === "number" ? row.member_id : null,
  };
}

function normalizeWhatGovMpRow(row: Record<string, unknown>): NationalCandidate | null {
  const firstName = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const lastName = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const name = [firstName, lastName].filter(Boolean).join(" ");
  if (!name) return null;
  return {
    name,
    party: typeof row.party === "string" ? row.party : null,
    constituency: typeof row.constituency === "string" ? row.constituency : null,
    portraitUrl: null,
    thumbnailUrl: null,
    memberId: typeof row.member_id === "number" ? row.member_id : null,
  };
}

function scoreSnippetRelevance(text: string, issueKeywords: string[]): number {
  const normalized = normalizeToken(text);
  return issueKeywords.reduce((total, keyword) => (normalized.includes(keyword) ? total + 1 : total), 0);
}

function collectStringSnippets(value: unknown, out: string[], depth = 0): void {
  if (depth > 5 || out.length >= 120) return;
  if (typeof value === "string") {
    const cleaned = value.trim();
    if (cleaned.length >= 20) out.push(cleaned);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringSnippets(item, out, depth + 1);
      if (out.length >= 120) return;
    }
    return;
  }
  if (isRecord(value)) {
    for (const next of Object.values(value)) {
      collectStringSnippets(next, out, depth + 1);
      if (out.length >= 120) return;
    }
  }
}

async function fetchContributionSnippets(tools: ToolMap, memberName: string, issueKeywords: string[]): Promise<{ snippets: string[]; score: number }> {
  const searches: Array<Record<string, unknown>> = [
    { path: "/search.json", format: "json", query: { searchTerm: memberName }, take: 12 },
    { path: "/search.json", format: "json", query: { query: memberName }, take: 12 },
    { path: "/search.json", format: "json", query: { speaker: memberName }, take: 12 },
  ];

  const rawResults: unknown[] = [];
  for (const args of searches) {
    const hansard = await callTool<unknown>(tools, "parliament_hansard", args);
    if (hansard) rawResults.push(hansard);
    const fetchHansard = await callTool<unknown>(tools, "parliament_fetchHansard", args);
    if (fetchHansard) rawResults.push(fetchHansard);
    if (rawResults.length >= 2) break;
  }

  const snippets: string[] = [];
  for (const item of rawResults) {
    collectStringSnippets(item, snippets);
    if (snippets.length >= 80) break;
  }

  const ranked = snippets
    .map((snippet) => ({ snippet, score: scoreSnippetRelevance(snippet, issueKeywords) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.snippet.localeCompare(b.snippet));

  const topSnippets = ranked.slice(0, 3).map((row) => row.snippet);
  const score = ranked.slice(0, 3).reduce((total, row) => total + row.score, 0);
  return { snippets: topSnippets, score };
}

async function fetchWhatGovContributionSnippets(
  memberName: string,
  issueKeywords: string[],
  debatesTable: string,
  env?: Env,
): Promise<{ snippets: string[]; score: number }> {
  const supabase = getSupabaseAdminSafe(env);
  if (!supabase) return { snippets: [], score: 0 };

  const { data, error } = await supabase
    .from(debatesTable)
    .select("title,summary,structured_summary,debate_date")
    .ilike("structured_summary", `%${memberName}%`)
    .order("debate_date", { ascending: false })
    .limit(24);
  if (error || !Array.isArray(data) || data.length === 0) return { snippets: [], score: 0 };

  const snippets: string[] = [];
  for (const row of data) {
    const structured = typeof row.structured_summary === "string" ? row.structured_summary : "";
    if (structured) {
      collectStringSnippets(structured, snippets);
    }
    if (typeof row.summary === "string" && row.summary.trim().length > 0) {
      snippets.push(row.summary.trim());
    }
    if (typeof row.title === "string" && row.title.trim().length > 0) {
      snippets.push(`Debate: ${row.title.trim()}`);
    }
    if (snippets.length >= 80) break;
  }

  const ranked = snippets
    .map((snippet) => ({ snippet, score: scoreSnippetRelevance(snippet, issueKeywords) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.snippet.localeCompare(b.snippet));

  const topSnippets = ranked.slice(0, 3).map((row) => row.snippet);
  const score = ranked.slice(0, 3).reduce((total, row) => total + row.score, 0);
  return { snippets: topSnippets, score };
}

async function fetchPartyCandidates(tools: ToolMap, target: NationalPartyTarget, nation: string | null): Promise<NationalCandidate[]> {
  const nationHint = nation && nation.length > 0 ? `${nation} ` : "";
  const searches = [...new Set([`${target.party} MP`, `${nationHint}${target.party}`, ...target.queryHints])];
  const candidatesByName = new Map<string, NationalCandidate>();
  for (const search of searches) {
    const raw = await callTool<unknown>(tools, "parliament_fetchMembers", { search, take: 40, skip: 0 });
    if (!raw) continue;
    for (const row of extractMemberRows(raw)) {
      const candidate = normalizeNationalCandidate(row);
      if (!candidate) continue;
      const key = normalizeToken(candidate.name);
      if (!candidatesByName.has(key)) candidatesByName.set(key, candidate);
    }
  }
  return [...candidatesByName.values()].filter((candidate) => partyMatches(candidate.party, target));
}

function collectSourceIds(raw: unknown): string[] {
  const ids: string[] = [];
  const rows = extractRowsFromSourcePayload(raw);
  for (const row of rows) {
    const possible = [row.operationId, row.source, row.id, row.name];
    for (const value of possible) {
      if (typeof value === "string" && value.trim().length > 0) ids.push(value.trim());
    }
  }
  return [...new Set(ids)];
}

async function fetchWhatGovNationalCandidates(tools: ToolMap, nation: string | null, mpsTable: string, env?: Env): Promise<NationalCandidate[]> {
  const supabase = getSupabaseAdminSafe(env);
  if (supabase) {
    const prefix = nationCodePrefix(nation);
    let query = supabase
      .from(mpsTable)
      .select("member_id,first_name,last_name,party,constituency,constituency_code")
      .not("member_id", "is", null)
      .limit(800);

    if (prefix) query = query.like("constituency_code", `${prefix}%`);
    const { data, error } = await query;
    if (!error && Array.isArray(data) && data.length > 0) {
      const byName = new Map<string, NationalCandidate>();
      for (const row of data) {
        const candidate = normalizeWhatGovMpRow(row as Record<string, unknown>);
        if (!candidate) continue;
        byName.set(normalizeToken(candidate.name), candidate);
      }
      if (byName.size > 0) return [...byName.values()];
    }
  }

  const listPayload = await callTool<unknown>(tools, "sources_list", {});
  const discoveredIds = collectSourceIds(listPayload);
  const sourceId =
    discoveredIds.find((id) => {
      const normalized = normalizeToken(id);
      return normalized.includes("whatgov") && (normalized.includes("member") || normalized.includes("parliament") || normalized.includes("commons") || normalized.includes("mp"));
    }) ?? null;
  if (!sourceId) return [];

  const queryArgsCandidates: Array<Record<string, unknown>> = [
    { source: sourceId, params: { nation: nation ?? "uk", limit: 300 } },
    { source: sourceId, params: { limit: 300 } },
    { source: sourceId },
  ];

  const byName = new Map<string, NationalCandidate>();
  for (const args of queryArgsCandidates) {
    const payload = await callTool<unknown>(tools, "sources_fetch", args);
    if (!payload) continue;
    for (const row of extractRowsFromSourcePayload(payload)) {
      const candidate = normalizeNationalCandidate(row);
      if (!candidate) continue;
      byName.set(normalizeToken(candidate.name), candidate);
    }
    if (byName.size > 0) break;
  }
  return [...byName.values()];
}

function asLocalMpResponse(candidate: NationalCandidate, target: NationalPartyTarget, snippets: string[]): LocalMpApiResponse {
  return {
    member: {
      name_display_as: candidate.name,
      party: candidate.party,
      constituency: candidate.constituency ?? "United Kingdom",
      portrait_url: candidate.portraitUrl,
      thumbnail_url: candidate.thumbnailUrl,
      contact: [],
    },
    committee_memberships: [],
    extras: {
      focus_areas: target.focusAreas,
      prior_contributions: snippets,
    },
  };
}

async function fetchLegacyNationalBundles(tools: ToolMap, nation: string | null): Promise<LocalMpApiResponse[]> {
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
  return [];
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

export async function fetchNationalMpRepresentativeBundle(tools: ToolMap, nation: string | null, issue: string, env?: Env): Promise<LocalMpApiResponse[]> {
  const targets = majorPartyTargetsForNation(nation);
  const issueKeywords = extractIssueKeywords(issue);
  const selectedBundles: LocalMpApiResponse[] = [];
  const usedNames = new Set<string>();
  const sourceSettings = await loadCouncilSourceSettings(env);
  const whatGovCandidates =
    sourceSettings.sourcePreference === "whatgov-first"
      ? await fetchWhatGovNationalCandidates(tools, nation, sourceSettings.whatGovMpsTable, env)
      : [];

  for (const target of targets) {
    const whatGovPartyCandidates = whatGovCandidates.filter((candidate) => partyMatches(candidate.party, target));
    const partyCandidates = whatGovPartyCandidates.length > 0 ? whatGovPartyCandidates : await fetchPartyCandidates(tools, target, nation);
    if (partyCandidates.length === 0) continue;

    const prelim = partyCandidates
      .map((candidate) => {
        const partyScore = partyMatches(candidate.party, target) ? 20 : 0;
        const issueScore = target.focusAreas.reduce(
          (total, focusArea) => (issueKeywords.some((keyword) => normalizeToken(focusArea).includes(keyword)) ? total + 2 : total),
          0,
        );
        return { candidate, score: partyScore + issueScore };
      })
      .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name))
      .slice(0, 3);

    let best: { candidate: NationalCandidate; score: number; snippets: string[] } | null = null;
    for (const row of prelim) {
      const dedupeKey = normalizeToken(row.candidate.name);
      if (usedNames.has(dedupeKey)) continue;
      const fromWhatGov = await fetchWhatGovContributionSnippets(row.candidate.name, issueKeywords, sourceSettings.whatGovDebatesTable, env);
      const contribution = fromWhatGov.snippets.length > 0 ? fromWhatGov : await fetchContributionSnippets(tools, row.candidate.name, issueKeywords);
      const totalScore = row.score + contribution.score;
      if (!best || totalScore > best.score) {
        best = {
          candidate: row.candidate,
          score: totalScore,
          snippets: contribution.snippets,
        };
      }
    }

    if (!best) continue;
    usedNames.add(normalizeToken(best.candidate.name));
    selectedBundles.push(asLocalMpResponse(best.candidate, target, best.snippets));
  }

  if (selectedBundles.length > 0) return selectedBundles;

  const legacy = await fetchLegacyNationalBundles(tools, nation);
  if (legacy.length > 0) return legacy;

  // Final fallback so Council Mode remains functional even if all lookups fail.
  return [
    { member: { name_display_as: "Representative MP 1", party: null, constituency: "UK", contact: [] }, committee_memberships: [] },
    { member: { name_display_as: "Representative MP 2", party: null, constituency: "UK", contact: [] }, committee_memberships: [] },
    { member: { name_display_as: "Representative MP 3", party: null, constituency: "UK", contact: [] }, committee_memberships: [] },
  ];
}

