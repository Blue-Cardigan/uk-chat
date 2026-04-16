export const UK_POSTCODE_REGEX = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

export function normalizePostcode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function extractUkPostcode(text: string): string | null {
  const match = text.match(UK_POSTCODE_REGEX);
  return match?.[1] ? normalizePostcode(match[1]) : null;
}
