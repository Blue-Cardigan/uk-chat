// Deterministic citation verification.
//
// Pulls every "substantive" numeric claim from the assistant's reply
// (counts, percentages, ranks like "1st"/"2nd", monetary figures, year-on-
// year deltas) and checks that each one appears in the tool outputs the
// model called this turn. When a number is in the answer but absent from
// the tool data, that's a hallucination signal — we flag it and append a
// "self-check" note pointing the user at the discrepancy.
//
// Cheap, deterministic, no LLM call. Complements the LLM verifier in
// verifier.ts: the LLM catches semantic mismatches ("the chart shows X but
// the answer says Y"); this catches "the answer says 1,793 but no tool ever
// returned 1,793". Numbers that don't pass our "substantive" threshold
// (single digits, common years, list ordinals) are exempt to avoid false
// positives.

import { isRecord } from "../../src/shared/type-guards.js";

// Patterns that look like numeric facts. Greedy: we'd rather flag a few
// extras than miss real hallucinations. The downstream "is it in the tool
// outputs?" check is forgiving — it accepts the same number with or without
// thousands separators or trailing zeros.
const NUMERIC_CLAIM_REGEX = /(?:£|\$|€)?\s*-?\d{1,3}(?:[,\s]\d{3})+|(?:£|\$|€)?\s*-?\d+(?:\.\d+)?\s*%?/g;

// Single digits and common reference numbers we should never flag.
const TRIVIAL_PATTERNS: ReadonlyArray<RegExp> = [
  /^\d$/, // 0–9
  /^1[0-9]$/, // 10–19
  /^[12]0\d{2}$/, // 2000–2099 — years; checked separately if cited as a year
  /^(?:1st|2nd|3rd|[4-9]th|10th)$/i, // ordinals
];

const NUMBER_NORMALISER = /[,£$€\s%]/g;

function normaliseNumber(token: string): string {
  // Strip currency, commas, spaces, percent signs, then collapse leading +
  return token.replace(NUMBER_NORMALISER, "").replace(/^\+/, "");
}

function isTrivial(rawToken: string, normalised: string): boolean {
  if (!normalised) return true;
  for (const pattern of TRIVIAL_PATTERNS) {
    if (pattern.test(rawToken.trim())) return true;
  }
  // Single digits or short whole numbers (counts ≤ 2 digits) are too noisy
  // — many legitimate references like "5 categories" never appear in tool
  // output verbatim because the tool returned 5 rows whose count happens
  // to equal 5.
  if (/^\d{1,2}$/.test(normalised)) return true;
  return false;
}

function flattenToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function buildToolOutputCorpus(parts: ReadonlyArray<unknown>): string {
  const fragments: string[] = [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (typeof part.type !== "string" || !part.type.startsWith("tool-")) continue;
    if (part.state !== "output-available") continue;
    fragments.push(flattenToString(part.output));
    // Also include the input args (occasionally models cite their own
    // request-level numbers like "1 mile radius" which we should accept).
    fragments.push(flattenToString(part.input));
  }
  return fragments.join("\n");
}

function extractAnswerText(parts: ReadonlyArray<unknown>): string {
  let out = "";
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") out += `\n${part.text}`;
  }
  return out;
}

export type CitationCheckResult = {
  unsubstantiated: Array<{ raw: string; normalised: string }>;
  total: number;
};

export function findUnsubstantiatedNumbers(parts: ReadonlyArray<unknown>): CitationCheckResult {
  const text = extractAnswerText(parts);
  const corpus = buildToolOutputCorpus(parts);
  if (!text || !corpus) return { unsubstantiated: [], total: 0 };

  const seenNormalised = new Set<string>();
  const unsubstantiated: Array<{ raw: string; normalised: string }> = [];
  let total = 0;

  for (const match of text.matchAll(NUMERIC_CLAIM_REGEX)) {
    const raw = match[0].trim();
    if (!raw) continue;
    const normalised = normaliseNumber(raw);
    if (isTrivial(raw, normalised)) continue;
    if (seenNormalised.has(normalised)) continue;
    seenNormalised.add(normalised);
    total += 1;

    // Try multiple forms when checking the corpus. Matches are forgiving:
    //   - Exact normalised digit string ("8375")
    //   - With thousands separator ("8,375")
    //   - As a whole-number prefix in JSON ('"count":8375')
    const numericValue = Number(normalised);
    const variants = [normalised];
    if (Number.isFinite(numericValue)) {
      variants.push(numericValue.toLocaleString("en-GB"));
      variants.push(String(numericValue));
      // Also accept the value embedded in JSON: "key":N or "key": N
      variants.push(`:${numericValue}`);
      variants.push(`: ${numericValue}`);
    }
    const corpusContains = variants.some((variant) => corpus.includes(variant));
    if (!corpusContains) {
      unsubstantiated.push({ raw, normalised });
    }
  }

  return { unsubstantiated, total };
}

export function renderCitationNote(result: CitationCheckResult): string | null {
  if (result.unsubstantiated.length === 0) return null;
  const sample = result.unsubstantiated.slice(0, 3).map((u) => u.raw).join(", ");
  const more = result.unsubstantiated.length > 3 ? ` (+${result.unsubstantiated.length - 3} more)` : "";
  return `\n\n**Note (self-check):** Some numbers in the answer above (${sample}${more}) couldn't be verified against the tool outputs for this turn. Treat them with caution — they may be model recall rather than fresh data.`;
}
