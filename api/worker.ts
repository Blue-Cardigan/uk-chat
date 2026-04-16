import { Hono } from "hono";
import { csrf } from "hono/csrf";
import type { Env } from "./env.js";
import { parseHttpUrl, isLoopbackHostname } from "./_lib/internals.js";
import { logError } from "./_lib/logger.js";
import { chatRoutes } from "./routes/chat.js";
import { councilRoutes } from "./routes/council.js";
import { conversationRoutes } from "./routes/conversations.js";
import { artifactRoutes } from "./routes/artifacts.js";
import { sharedRoutes } from "./routes/shared.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { privacyRoutes } from "./routes/privacy.js";
import { accountRoutes } from "./routes/account.js";
import { cronRoutes, runDataRetention } from "./routes/cron.js";
import { assertMcpEncryptionConfigured } from "./_lib/crypto.js";

export type CsrfPolicy =
  | { kind: "skip" }
  | { kind: "loopback" }
  | { kind: "allowlist"; origins: string[] }
  | { kind: "misconfigured" };

export function resolveCsrfPolicy(input: {
  method: string;
  requestUrl: string;
  appUrl: string | undefined;
  inviteAppUrl: string | undefined;
}): CsrfPolicy {
  const method = input.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return { kind: "skip" };

  const requestOrigin = parseHttpUrl(input.requestUrl);
  const path = requestOrigin?.pathname ?? "";
  // Cron endpoints authenticate via HMAC; skip CSRF origin check.
  if (path.startsWith("/api/cron")) return { kind: "skip" };

  if (requestOrigin && isLoopbackHostname(requestOrigin.hostname)) return { kind: "loopback" };

  const allowedOrigins = new Set<string>();
  const configured = parseHttpUrl(input.appUrl?.trim());
  if (configured) allowedOrigins.add(configured.origin);
  const inviteConfigured = parseHttpUrl(input.inviteAppUrl?.trim());
  if (inviteConfigured) allowedOrigins.add(inviteConfigured.origin);

  if (allowedOrigins.size === 0) return { kind: "misconfigured" };
  return { kind: "allowlist", origins: Array.from(allowedOrigins) };
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const policy = resolveCsrfPolicy({
    method: c.req.method,
    requestUrl: c.req.raw.url,
    appUrl: c.env.APP_URL,
    inviteAppUrl: c.env.INVITE_APP_URL,
  });

  if (policy.kind === "skip") return next();
  if (policy.kind === "loopback") {
    return csrf({ origin: (origin) => {
      const parsed = parseHttpUrl(origin);
      return Boolean(parsed && isLoopbackHostname(parsed.hostname));
    } })(c, next);
  }
  if (policy.kind === "misconfigured") {
    logError("[csrf] APP_URL not configured — refusing state-changing request", {
      path: new URL(c.req.raw.url).pathname,
    });
    return c.json({ error: "Server misconfigured" }, 500);
  }
  return csrf({ origin: policy.origins })(c, next);
});

app.get("/api/health", (c) => {
  try {
    assertMcpEncryptionConfigured();
    return c.json({ ok: true });
  } catch (error) {
    logError("[health] check failed", { error: error instanceof Error ? error.message : String(error) });
    return c.json({ ok: false, error: "unhealthy" }, 500);
  }
});

app.route("/api/chat", chatRoutes);
app.route("/api/council", councilRoutes);
app.route("/api/conversations", conversationRoutes);
app.route("/api/artifacts", artifactRoutes);
app.route("/api/shared", sharedRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/privacy", privacyRoutes);
app.route("/api/account", accountRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/cron", cronRoutes);

app.get("/api", (c) => c.json({ ok: true }));

export default {
  fetch: app.fetch,
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    ctx.waitUntil(
      runDataRetention(env).catch((err) => {
        logError("[worker/scheduled] Data retention task threw", {
          error: err instanceof Error ? err.message : String(err),
        });
      }),
    );
  },
};
