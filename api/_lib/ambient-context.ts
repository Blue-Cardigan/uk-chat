// Deterministic ambient-context layer for chatgb.
//
// Runs BEFORE the LLM sees the prompt. Detects high-confidence entities (UK
// postcodes, for now) via regex and resolves them with a single deterministic
// HTTP call. The resolved values are injected into the system prompt so that
// models — especially weak ones like Flash and Haiku-tier — skip the
// look-up-then-use chain that the literature flags as the dominant cause of
// agent failures with small models.
//
// Pattern is the same one Cursor uses for @-mentions and Perplexity uses for
// URLs in queries: deterministic short-circuit for things that don't need an
// LLM.

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
    // Insert space before final 3 chars if absent (NORMALISED → "NORM ALISED").
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

export type AmbientContext = {
  postcodes: AmbientPostcode[];
};

export async function buildAmbientContext(
  query: string | null | undefined,
  options: { fetchImpl?: typeof fetch; maxPostcodes?: number } = {},
): Promise<AmbientContext> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxPostcodes = options.maxPostcodes ?? 3;
  const detected = detectUkPostcodes(query).slice(0, maxPostcodes);
  if (detected.length === 0) return { postcodes: [] };
  const resolved = await Promise.all(detected.map((p) => resolvePostcode(p, fetchImpl)));
  return { postcodes: resolved.filter((entry): entry is AmbientPostcode => entry !== null) };
}

/**
 * Render the ambient context as a system-prompt block. Intentionally terse and
 * imperative — long passages get ignored by weaker models.
 */
export function renderAmbientContextBlock(context: AmbientContext): string {
  if (context.postcodes.length === 0) return "";
  const lines: string[] = [];
  lines.push("AMBIENT CONTEXT — already resolved (do NOT re-fetch via postcodes_lookup):");
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
  lines.push(
    "Use the resolved coordinates / area codes above directly when calling data tools. Pass `postcode` to adapters that accept it (e.g. police_fetchCrimes). Skip postcodes_lookup unless you need an additional postcode that is not pre-resolved here.",
  );
  return lines.join("\n");
}
