function hashValue(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sanitizeKeyValue(key: string, value: unknown): unknown {
  const keyLower = key.toLowerCase();
  if (keyLower.includes("token") || keyLower.includes("secret") || keyLower.includes("authorization")) return "[redacted]";
  if (keyLower.includes("email") && typeof value === "string") return `email:${hashValue(value.toLowerCase())}`;
  if (keyLower.includes("userid") && typeof value === "string") return `user:${hashValue(value)}`;
  if (keyLower === "error" && typeof value === "string" && value.length > 600) return `${value.slice(0, 600)}...[truncated]`;
  if (typeof value === "string" && value.length > 1000) return `${value.slice(0, 1000)}...[truncated]`;
  return value;
}

function sanitizeContext(input: unknown): unknown {
  if (Array.isArray(input)) return input.map((item) => sanitizeContext(item));
  if (!input || typeof input !== "object") return input;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value && typeof value === "object") {
      out[key] = sanitizeContext(value);
      continue;
    }
    out[key] = sanitizeKeyValue(key, value);
  }
  return out;
}

export function logWarn(message: string, context?: unknown) {
  if (context === undefined) {
    console.warn(message);
    return;
  }
  console.warn(message, sanitizeContext(context));
}

export function logError(message: string, context?: unknown) {
  if (context === undefined) {
    console.error(message);
    return;
  }
  console.error(message, sanitizeContext(context));
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
