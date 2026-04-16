import { z } from "zod";
import type { Context } from "hono";
import { json } from "./server.js";
import { logWarn, logError } from "./logger.js";

export const uuidSchema = z.string().uuid();
export const emailSchema = z.string().trim().toLowerCase().email().max(320);
export const shareTokenSchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/);

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.filter((segment) => typeof segment === "string" || typeof segment === "number").join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export async function parseJson<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<
  { ok: true; data: z.infer<S> } | { ok: false; response: Response }
> {
  let raw: unknown;
  try {
    raw = await c.req.raw.json();
  } catch {
    return { ok: false, response: json({ error: "Request body must be valid JSON" }, 400) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, response: json({ error: firstIssueMessage(result.error) }, 400) };
  }
  return { ok: true, data: result.data as z.infer<S> };
}

export function parseParam<S extends z.ZodTypeAny>(
  c: Context,
  name: string,
  schema: S,
): { ok: true; data: z.infer<S> } | { ok: false; response: Response } {
  const value = c.req.param(name);
  const result = schema.safeParse(value);
  if (!result.success) {
    return { ok: false, response: json({ error: `Invalid ${name}` }, 400) };
  }
  return { ok: true, data: result.data as z.infer<S> };
}

export function parseQuery<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): { ok: true; data: z.infer<S> } | { ok: false; response: Response } {
  const url = new URL(c.req.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  const result = schema.safeParse(params);
  if (!result.success) {
    return { ok: false, response: json({ error: firstIssueMessage(result.error) }, 400) };
  }
  return { ok: true, data: result.data as z.infer<S> };
}

type SupabaseLikeError = { message?: string | null; code?: string | null };

export function dbError(
  error: SupabaseLikeError | null | undefined,
  options: { context: string; publicMessage?: string; status?: number; extra?: Record<string, unknown> },
): Response {
  const publicMessage = options.publicMessage ?? "Request failed. Please try again.";
  const status = options.status ?? 500;
  if (error) {
    logError(`[${options.context}] database error`, {
      error: error.message ?? null,
      code: error.code ?? null,
      ...options.extra,
    });
  } else {
    logWarn(`[${options.context}] unknown failure`, options.extra ?? {});
  }
  return json({ error: publicMessage }, status);
}
