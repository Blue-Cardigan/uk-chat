// Deterministic ambient-context layer for chatgb.
//
// Runs BEFORE the LLM sees the prompt. Detects high-confidence entities (UK
// postcodes, constituencies, MPs, dates) via pattern matching and resolves
// them deterministically. The resolved values are injected into the system
// prompt so that models — especially weak ones like Flash and Haiku-tier —
// skip the look-up-then-use chain that the literature flags as the dominant
// cause of agent failures with small models.
//
// Pattern is the same one Cursor uses for @-mentions and Perplexity uses for
// URLs in queries: deterministic short-circuit for things that don't need an
// LLM.

import mpsRaw from "./data/uk-mps.json" with { type: "json" };
import ladsRaw from "./data/uk-lads.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Postcodes (resolved live via postcodes.io)
// ---------------------------------------------------------------------------

// Build a fresh regex each call. A shared global `RegExp` has lastIndex
// state that the `String.prototype.matchAll` spec is meant to ignore but
// that has historically caused subtle "second call returns nothing" bugs.
function buildPostcodeRegex(): RegExp {
  return /\b(GIR\s*0AA|[A-PR-UWYZ]([0-9]{1,2}|([A-HK-Y][0-9]([0-9ABEHMNPRV-Y])?)|[0-9][A-HJKPS-UW])\s*[0-9][ABD-HJLNP-UW-Z]{2})\b/gi;
}

export type AmbientPostcode = {
  postcode: string;
  latitude: number;
  longitude: number;
  parliamentaryConstituency: string | null;
  adminDistrict: string | null;
  adminWard: string | null;
  region: string | null;
  lsoa: string | null;
  msoa: string | null;
};

export function detectUkPostcodes(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const match of text.matchAll(buildPostcodeRegex())) {
    const normalized = match[0].toUpperCase().replace(/\s+/g, " ").trim();
    const cleaned = /\s/.test(normalized)
      ? normalized
      : `${normalized.slice(0, -3)} ${normalized.slice(-3)}`;
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      matches.push(cleaned);
    }
  }
  return matches;
}

async function resolvePostcode(postcode: string, fetchImpl: typeof fetch = fetch): Promise<AmbientPostcode | null> {
  try {
    const response = await fetchImpl(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { result?: Record<string, unknown> };
    const result = payload.result;
    if (!result || typeof result !== "object") return null;
    const lat = result.latitude;
    const lng = result.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    const str = (key: string) => (typeof result[key] === "string" ? (result[key] as string) : null);
    return {
      postcode,
      latitude: lat,
      longitude: lng,
      parliamentaryConstituency: str("parliamentary_constituency"),
      adminDistrict: str("admin_district"),
      adminWard: str("admin_ward"),
      region: str("region"),
      lsoa: str("lsoa"),
      msoa: str("msoa"),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Constituencies + MPs (resolved from a bundled snapshot)
//
// The snapshot is fetched once from members-api.parliament.uk and committed
// to the repo. It captures all 650 current UK Commons MPs with their
// constituency, member ID and party. We use it for two-way detection:
// - "Bristol West" → MP, party, member ID
// - "Keir Starmer" → constituency, party, member ID
// ---------------------------------------------------------------------------

type MpRecord = { constituency: string; name: string; memberId: number; party: string | null };
const MPS: readonly MpRecord[] = mpsRaw as MpRecord[];

// Sort once, longest-name-first, so we always prefer the most specific match
// (e.g. "Bristol West and East Bristol" before "Bristol West"). Names that
// could collide with common English words ("Speaker", "Chair") are excluded.
const COMMON_WORD_BLOCKLIST = new Set(["chair", "speaker"]);

const CONSTITUENCY_INDEX = [...MPS]
  .filter((m) => !COMMON_WORD_BLOCKLIST.has(m.constituency.toLowerCase()))
  .sort((a, b) => b.constituency.length - a.constituency.length);

// MP name index — strip honorifics so "Diane Abbott" matches "Ms Diane Abbott".
function stripHonorific(name: string): string {
  return name.replace(/^(Mr|Mrs|Ms|Miss|Dr|Sir|Dame|Rt Hon|The Rt Hon)\.?\s+/i, "").trim();
}

const MP_NAME_INDEX = [...MPS]
  .map((m) => ({ ...m, searchName: stripHonorific(m.name) }))
  .filter((m) => m.searchName.split(/\s+/).length >= 2)
  .sort((a, b) => b.searchName.length - a.searchName.length);

export type AmbientMp = {
  matchedAs: string;
  name: string;
  constituency: string;
  memberId: number;
  party: string | null;
};

export function detectConstituencies(text: string | null | undefined): AmbientMp[] {
  if (!text) return [];
  const haystack = text.toLowerCase();
  const consumed: Array<[number, number]> = [];
  const matches: AmbientMp[] = [];
  const seen = new Set<number>();

  for (const record of CONSTITUENCY_INDEX) {
    if (seen.has(record.memberId)) continue;
    const needle = record.constituency.toLowerCase();
    const idx = haystack.indexOf(needle);
    if (idx === -1) continue;
    // Word-boundary check: avoid matching mid-word
    const before = idx === 0 ? " " : haystack[idx - 1];
    const after = idx + needle.length >= haystack.length ? " " : haystack[idx + needle.length];
    if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
    // Overlap check: don't double-match a span we already captured
    const span: [number, number] = [idx, idx + needle.length];
    if (consumed.some(([s, e]) => !(span[1] <= s || span[0] >= e))) continue;
    consumed.push(span);
    seen.add(record.memberId);
    matches.push({
      matchedAs: record.constituency,
      name: record.name,
      constituency: record.constituency,
      memberId: record.memberId,
      party: record.party,
    });
  }

  return matches;
}

export function detectMpNames(text: string | null | undefined): AmbientMp[] {
  if (!text) return [];
  const haystack = text.toLowerCase();
  const matches: AmbientMp[] = [];
  const seen = new Set<number>();

  for (const record of MP_NAME_INDEX) {
    if (seen.has(record.memberId)) continue;
    const needle = record.searchName.toLowerCase();
    const idx = haystack.indexOf(needle);
    if (idx === -1) continue;
    const before = idx === 0 ? " " : haystack[idx - 1];
    const after = idx + needle.length >= haystack.length ? " " : haystack[idx + needle.length];
    if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
    seen.add(record.memberId);
    matches.push({
      matchedAs: record.searchName,
      name: record.name,
      constituency: record.constituency,
      memberId: record.memberId,
      party: record.party,
    });
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Local Authority Districts (resolved from a bundled snapshot)
//
// 361 LADs across England, Scotland, Wales and Northern Ireland with their
// GSS codes (LAD24CD), pulled once from the ONS Open Geography Portal.
// Mentions of council names map to the canonical {name, code} so callers can
// pass the GSS code straight to ONS / NHS / planning tools.
// ---------------------------------------------------------------------------

type LadRecord = { name: string; code: string };
const LADS: readonly LadRecord[] = ladsRaw as LadRecord[];

// Names like "City" or "Council" alone are far too noisy to substring-match.
// Anything shorter than 4 characters is also rejected at detection time.
const LAD_NAME_BLOCKLIST = new Set([
  "city",
  "council",
  "north",
  "south",
  "east",
  "west",
  "central",
]);

const LAD_INDEX = [...LADS]
  .filter((l) => !LAD_NAME_BLOCKLIST.has(l.name.toLowerCase()) && l.name.length >= 4)
  .sort((a, b) => b.name.length - a.name.length);

export type AmbientLad = {
  matchedAs: string;
  name: string;
  code: string;
};

export function detectLads(text: string | null | undefined): AmbientLad[] {
  if (!text) return [];
  const haystack = text.toLowerCase();
  const consumed: Array<[number, number]> = [];
  const matches: AmbientLad[] = [];
  const seen = new Set<string>();

  for (const record of LAD_INDEX) {
    if (seen.has(record.code)) continue;
    const needle = record.name.toLowerCase();
    const idx = haystack.indexOf(needle);
    if (idx === -1) continue;
    const before = idx === 0 ? " " : haystack[idx - 1];
    const after = idx + needle.length >= haystack.length ? " " : haystack[idx + needle.length];
    if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
    const span: [number, number] = [idx, idx + needle.length];
    if (consumed.some(([s, e]) => !(span[1] <= s || span[0] >= e))) continue;
    consumed.push(span);
    seen.add(record.code);
    matches.push({ matchedAs: record.name, name: record.name, code: record.code });
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Dates (resolved from natural-language references)
// ---------------------------------------------------------------------------

export type AmbientDate = {
  matchedAs: string;
  // Canonical YYYY-MM forms covering the requested range
  months: string[];
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function monthYearRange(year: number, month: number, count: number, direction: 1 | -1 = -1): string[] {
  const out: string[] = [];
  let y = year;
  let m = month;
  for (let i = 0; i < count; i += 1) {
    out.push(`${y}-${pad2(m)}`);
    m += direction;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function detectDateReferences(text: string | null | undefined, now: Date = new Date()): AmbientDate[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1..12
  const matches: AmbientDate[] = [];
  const push = (matchedAs: string, months: string[]): void => {
    if (months.length === 0) return;
    if (matches.some((m) => m.matchedAs === matchedAs)) return;
    matches.push({ matchedAs, months });
  };

  // Explicit YYYY-MM
  for (const ymMatch of lower.matchAll(/\b(20\d{2})-(0[1-9]|1[0-2])\b/g)) {
    push(ymMatch[0], [ymMatch[0]]);
  }
  // Explicit year only (with word boundaries to avoid postcode collisions)
  for (const yearMatch of lower.matchAll(/\b(20\d{2})\b/g)) {
    const y = Number(yearMatch[1]);
    if (y < 2000 || y > year + 1) continue;
    if (matches.some((m) => m.matchedAs.startsWith(yearMatch[1]))) continue;
    push(yearMatch[0], Array.from({ length: 12 }, (_, i) => `${y}-${pad2(i + 1)}`));
  }

  if (/\blast\s+month\b/.test(lower)) {
    const [m1] = monthYearRange(year, month, 2, -1).slice(1);
    if (m1) push("last month", [m1]);
  }
  if (/\bthis\s+month\b/.test(lower)) {
    push("this month", [`${year}-${pad2(month)}`]);
  }
  if (/\blast\s+year\b/.test(lower)) {
    push("last year", Array.from({ length: 12 }, (_, i) => `${year - 1}-${pad2(i + 1)}`));
  }
  if (/\bthis\s+year\b/.test(lower)) {
    push("this year", Array.from({ length: month }, (_, i) => `${year}-${pad2(i + 1)}`));
  }
  if (/\bpast\s+(\d{1,2})\s+months?\b/.test(lower) || /\blast\s+(\d{1,2})\s+months?\b/.test(lower)) {
    const m = (lower.match(/\b(?:past|last)\s+(\d{1,2})\s+months?\b/) ?? [])[1];
    if (m) {
      const n = Math.max(1, Math.min(36, Number(m)));
      const range = monthYearRange(year, month, n + 1, -1).slice(1).reverse();
      push(`past ${n} months`, range);
    }
  }
  // Quarter detection: "Q1 2026", "2026 Q1"
  for (const qMatch of lower.matchAll(/\bq([1-4])\s*(20\d{2})\b/g)) {
    const q = Number(qMatch[1]);
    const y = Number(qMatch[2]);
    const startMonth = (q - 1) * 3 + 1;
    push(qMatch[0], [`${y}-${pad2(startMonth)}`, `${y}-${pad2(startMonth + 1)}`, `${y}-${pad2(startMonth + 2)}`]);
  }
  for (const qMatch of lower.matchAll(/\b(20\d{2})\s*q([1-4])\b/g)) {
    const y = Number(qMatch[1]);
    const q = Number(qMatch[2]);
    const startMonth = (q - 1) * 3 + 1;
    push(qMatch[0], [`${y}-${pad2(startMonth)}`, `${y}-${pad2(startMonth + 1)}`, `${y}-${pad2(startMonth + 2)}`]);
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Free-text place names (resolved live via OSM Nominatim)
//
// Catches the long tail of UK place names that aren't postcodes, current
// constituencies, MPs or LADs — e.g. "Finsbury Park", "Mayfair", "Camden
// Market", "Borough Market". Uses a deliberately conservative detector:
// only trigger on a well-formed prepositional phrase ("in <Title Case>",
// "near <Title Case>", etc.) so we don't fire on every capitalised word.
// Geocoding goes through OSM Nominatim with a UK country-code filter; their
// usage policy expects a User-Agent and ≤1 req/sec, both honoured here.
// ---------------------------------------------------------------------------

const PLACE_PHRASE_REGEX =
  /\b(?:in|near|around|at|for|across|throughout|within)\s+((?:[A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+){0,3}))\b/g;

// Words that pass the title-case heuristic but are not real place tokens.
const PLACE_DETECTOR_BLOCKLIST = new Set([
  "the",
  "england",
  "scotland",
  "wales",
  "northern ireland",
  "uk",
  "united kingdom",
  "great britain",
  "britain",
  "europe",
  "london",
  // Common mis-fires from question phrasing
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export type AmbientPlace = {
  matchedAs: string;
  displayName: string;
  latitude: number;
  longitude: number;
  council: string | null;
  region: string | null;
};

export function detectPlacePhrases(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const match of text.matchAll(PLACE_PHRASE_REGEX)) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    const normalized = candidate.toLowerCase();
    if (PLACE_DETECTOR_BLOCKLIST.has(normalized)) continue;
    // Skip single-word items shorter than 5 chars to suppress noise like "in The".
    if (!/\s/.test(candidate) && candidate.length < 5) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    matches.push(candidate);
  }
  return matches;
}

async function geocodePlace(
  candidate: string,
  fetchImpl: typeof fetch,
): Promise<AmbientPlace | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", candidate);
    url.searchParams.set("countrycodes", "gb");
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "1");
    const response = await fetchImpl(url.toString(), {
      headers: {
        accept: "application/json",
        "user-agent": "chatgb (https://chatgb.co.uk) — UK gov data agent",
      },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as Array<{
      lat?: string;
      lon?: string;
      display_name?: string;
      address?: Record<string, string>;
    }>;
    const top = payload[0];
    if (!top) return null;
    const lat = Number(top.lat);
    const lng = Number(top.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const address = top.address ?? {};
    return {
      matchedAs: candidate,
      displayName: top.display_name ?? candidate,
      latitude: lat,
      longitude: lng,
      council:
        address.city ??
        address.town ??
        address.county ??
        address.state_district ??
        address.borough ??
        null,
      region: address.state ?? null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Aggregator + renderer
// ---------------------------------------------------------------------------

export type AmbientContext = {
  postcodes: AmbientPostcode[];
  constituencies: AmbientMp[];
  mpsByName: AmbientMp[];
  lads: AmbientLad[];
  places: AmbientPlace[];
  dates: AmbientDate[];
};

export async function buildAmbientContext(
  query: string | null | undefined,
  options: {
    fetchImpl?: typeof fetch;
    maxPostcodes?: number;
    maxEntitiesPerKind?: number;
    now?: Date;
  } = {},
): Promise<AmbientContext> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxPostcodes = options.maxPostcodes ?? 3;
  const cap = options.maxEntitiesPerKind ?? 3;
  const now = options.now ?? new Date();

  const detectedPostcodes = detectUkPostcodes(query).slice(0, maxPostcodes);
  const postcodesPromise = Promise.all(detectedPostcodes.map((p) => resolvePostcode(p, fetchImpl)));

  const constituencies = detectConstituencies(query).slice(0, cap);
  const detectedMps = detectMpNames(query);
  // De-dupe vs constituencies — if the same MP was matched both ways, keep the constituency entry
  const constituencyMemberIds = new Set(constituencies.map((c) => c.memberId));
  const mpsByName = detectedMps.filter((m) => !constituencyMemberIds.has(m.memberId)).slice(0, cap);
  const lads = detectLads(query).slice(0, cap);
  const dates = detectDateReferences(query, now).slice(0, cap);

  // Free-text place geocoding. Only fires when no postcode was already
  // detected, since postcodes give precise coordinates and a free-text
  // place would be redundant (and a wasted Nominatim hit).
  const placesPromise: Promise<AmbientPlace[]> = (async () => {
    if (detectedPostcodes.length > 0) return [];
    const candidates = detectPlacePhrases(query).slice(0, 2);
    if (candidates.length === 0) return [];
    const resolved = await Promise.all(candidates.map((c) => geocodePlace(c, fetchImpl)));
    return resolved.filter((entry): entry is AmbientPlace => entry !== null);
  })();

  const [postcodesResolved, places] = await Promise.all([postcodesPromise, placesPromise]);
  return {
    postcodes: postcodesResolved.filter((entry): entry is AmbientPostcode => entry !== null),
    constituencies,
    mpsByName,
    lads,
    places,
    dates,
  };
}

export function renderAmbientContextBlock(context: AmbientContext): string {
  const sections: string[] = [];

  if (context.postcodes.length > 0) {
    const lines: string[] = ["Postcodes (do NOT re-fetch via postcodes_lookup):"];
    for (const p of context.postcodes) {
      const parts: string[] = [
        `${p.postcode} → lat=${p.latitude.toFixed(6)}, lng=${p.longitude.toFixed(6)}`,
      ];
      if (p.parliamentaryConstituency) parts.push(`constituency="${p.parliamentaryConstituency}"`);
      if (p.adminDistrict) parts.push(`council="${p.adminDistrict}"`);
      if (p.adminWard) parts.push(`ward="${p.adminWard}"`);
      if (p.region) parts.push(`region="${p.region}"`);
      if (p.lsoa) parts.push(`lsoa="${p.lsoa}"`);
      if (p.msoa) parts.push(`msoa="${p.msoa}"`);
      lines.push(`- ${parts.join("; ")}`);
    }
    sections.push(lines.join("\n"));
  }

  if (context.constituencies.length > 0) {
    const lines: string[] = ["Parliamentary constituencies (already resolved — pass these names directly to MP/voting tools):"];
    for (const m of context.constituencies) {
      lines.push(
        `- "${m.constituency}" → MP: ${m.name}${m.party ? ` (${m.party})` : ""}; memberId=${m.memberId}`,
      );
    }
    sections.push(lines.join("\n"));
  }

  if (context.mpsByName.length > 0) {
    const lines: string[] = ["MPs detected by name (already resolved — pass memberId or constituency directly):"];
    for (const m of context.mpsByName) {
      lines.push(
        `- "${m.matchedAs}" → ${m.name}${m.party ? ` (${m.party})` : ""}; constituency="${m.constituency}"; memberId=${m.memberId}`,
      );
    }
    sections.push(lines.join("\n"));
  }

  if (context.places.length > 0) {
    const lines: string[] = [
      "Places (free-text resolved via OSM Nominatim — pass these coordinates to lat/lng-aware tools, or use the council name if a tool accepts it):",
    ];
    for (const p of context.places) {
      const parts: string[] = [
        `"${p.matchedAs}" → lat=${p.latitude.toFixed(6)}, lng=${p.longitude.toFixed(6)}`,
      ];
      if (p.council) parts.push(`council="${p.council}"`);
      if (p.region) parts.push(`region="${p.region}"`);
      parts.push(`(${p.displayName})`);
      lines.push(`- ${parts.join("; ")}`);
    }
    sections.push(lines.join("\n"));
  }

  if (context.lads.length > 0) {
    const lines: string[] = ["Local Authority Districts (already resolved — pass the GSS code or name directly to ONS / NHS / planning tools):"];
    for (const l of context.lads) {
      lines.push(`- "${l.name}" → GSS code ${l.code}`);
    }
    sections.push(lines.join("\n"));
  }

  if (context.dates.length > 0) {
    const lines: string[] = ["Date references (canonical YYYY-MM forms — pass these to date-aware tools):"];
    for (const d of context.dates) {
      const preview = d.months.length > 4 ? `${d.months.slice(0, 2).join(", ")}, …, ${d.months.at(-1)}` : d.months.join(", ");
      lines.push(`- "${d.matchedAs}" → ${preview} (${d.months.length} month${d.months.length === 1 ? "" : "s"})`);
    }
    sections.push(lines.join("\n"));
  }

  if (sections.length === 0) return "";

  return [
    "AMBIENT CONTEXT — entities already resolved from the user's prompt. Use these values directly; do NOT call lookup tools to re-fetch them.",
    ...sections,
  ].join("\n\n");
}
