import { Hono } from "hono";
import type { Env } from "./env.js";
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

const app = new Hono<{ Bindings: Env }>();

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
    ctx.waitUntil(runDataRetention(env));
  },
};
