import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import { getSupabaseAdmin, json } from "../_lib/server.js";
import { isDevBypassEnabled, isAllowedEmailDomain, getEmailDomain, getAuthRedirectBase } from "../_lib/internals.js";
import { onboardUser } from "../_lib/onboarding.js";
import { logWarn, logError } from "../_lib/logger.js";
import { parseJson, emailSchema, dbError } from "../_lib/validation.js";
import { ipRateLimit } from "../_lib/rate-limit.js";

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.use("*", ipRateLimit("AUTH_LIMITER"));

const emailBodySchema = z.object({ email: emailSchema });

authRoutes.post("/check-email", async (c) => {
  const parsed = await parseJson(c, emailBodySchema);
  if ("response" in parsed) return parsed.response;
  const normalizedEmail = parsed.data.email;

  if (isDevBypassEnabled()) {
    return json({ allowed: true, message: "Dev bypass: any email accepted." });
  }

  const supabase = getSupabaseAdmin(c.env);
  const { data, error } = await supabase.from("uk_chat_email_gate").select("email").eq("email", normalizedEmail).maybeSingle();
  if (error) return dbError(error, { context: "api/auth/check-email", publicMessage: "Unable to verify email access right now" });
  if (!data && isAllowedEmailDomain(normalizedEmail, c.env)) {
    return json({
      allowed: true,
      message: "Email recognized via your organization domain. Continue to sign in for first-time setup.",
    });
  }
  if (!data) return json({ allowed: false, message: "Email not found. Ask Jethro to get you access." }, 404);

  return json({
    allowed: true,
    message: "Email recognized. Use the magic link that was sent to your inbox by your admin.",
  });
});

authRoutes.post("/sign-in", async (c) => {
  const parsed = await parseJson(c, emailBodySchema);
  if ("response" in parsed) return parsed.response;
  const normalizedEmail = parsed.data.email;

  const supabase = getSupabaseAdmin(c.env);

  if (!isDevBypassEnabled()) {
    const { data: gateRow, error: gateError } = await supabase
      .from("uk_chat_email_gate")
      .select("email")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (gateError) return dbError(gateError, { context: "api/auth/sign-in", publicMessage: "Unable to verify email access right now" });
    if (!gateRow) {
      if (!isAllowedEmailDomain(normalizedEmail, c.env)) {
        return json({
          allowed: false,
          message: "Email not found. Ask Jethro to get you access.",
        });
      }
      const domain = getEmailDomain(normalizedEmail);
      try {
        await onboardUser({ email: normalizedEmail, sendEmail: false }, c.env);
        logWarn("[api/auth] Auto-provisioned user via domain allowlist", {
          email: normalizedEmail,
          domain,
        });
      } catch (error) {
        logError("[api/auth] Domain allowlist auto-provisioning failed", {
          email: normalizedEmail,
          domain,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const redirectBase = getAuthRedirectBase(c.req.raw, c.env);
  const callbackUrl = `${redirectBase.replace(/\/+$/, "")}/auth/callback`;
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: normalizedEmail,
    options: {
      redirectTo: callbackUrl,
    },
  });
  if (linkError) {
    return dbError(linkError, { context: "api/auth/sign-in", publicMessage: "Unable to sign in right now. Please try again." });
  }

  const actionLink = linkData?.properties?.action_link;
  if (!actionLink) return json({ error: "Unable to sign in right now. Please try again." }, 500);

  const parsedLink = new URL(actionLink);
  parsedLink.searchParams.set("redirect_to", callbackUrl);
  return json({ allowed: true, redirectTo: parsedLink.toString() });
});

authRoutes.get("/callback", async () => {
  return json({ ok: true });
});
