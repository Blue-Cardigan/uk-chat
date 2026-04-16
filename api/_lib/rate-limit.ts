import type { MiddlewareHandler } from "hono";
import type { Env, RateLimiter } from "../env.js";
import { getUserFromRequest, json } from "./server.js";

type LimiterKind = "CHAT_LIMITER" | "AUTH_LIMITER" | "SHARE_LIMITER";

function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

function rateLimitResponse(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfterSeconds),
    },
  });
}

async function enforce(limiter: RateLimiter | undefined, key: string, retryAfter: number): Promise<Response | null> {
  if (!limiter) return null;
  const { success } = await limiter.limit({ key });
  return success ? null : rateLimitResponse(retryAfter);
}

export function ipRateLimit(kind: LimiterKind, retryAfterSeconds = 60): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const blocked = await enforce(c.env[kind], `ip:${getClientIp(c.req.raw)}`, retryAfterSeconds);
    if (blocked) return blocked;
    await next();
  };
}

export function userRateLimit(kind: LimiterKind, retryAfterSeconds = 60): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const user = await getUserFromRequest(c.req.raw, c.env);
    const key = user ? `user:${user.id}` : `ip:${getClientIp(c.req.raw)}`;
    const blocked = await enforce(c.env[kind], key, retryAfterSeconds);
    if (blocked) return blocked;
    await next();
  };
}

export { json };
