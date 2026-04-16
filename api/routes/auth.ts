import { Hono } from "hono";
import type { Env } from "../env.js";
import { getSupabaseAdmin, json } from "../_lib/server.js";
import { isDevBypassEnabled, isAllowedEmailDomain, getEmailDomain, getAuthRedirectBase } from "../_lib/internals.js";
import { onboardUser } from "../_lib/onboarding.js";
import { logWarn, logError } from "../_lib/logger.js";

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post("/check-email", async (c) => {
  const { email } = (await c.req.json()) as { email?: string };
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return json({ error: "Email is required" }, 400);
  }

  if (isDevBypassEnabled()) {
    return json({ allowed: true, message: "Dev bypass: any email accepted." });
  }

  const supabase = getSupabaseAdmin(c.env);
  const { data, error } = await supabase.from("uk_chat_email_gate").select("email").eq("email", normalizedEmail).maybeSingle();
  if (error) return json({ error: "Unable to verify email access right now" }, 500);
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
  const { email } = (await c.req.json()) as { email?: string };
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    return json({ error: "Email is required" }, 400);
  }

  const supabase = getSupabaseAdmin(c.env);

  if (!isDevBypassEnabled()) {
    const { data: gateRow, error: gateError } = await supabase
      .from("uk_chat_email_gate")
      .select("email")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (gateError) return json({ error: "Unable to verify email access right now" }, 500);
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
    return json({ error: "Unable to sign in right now. Please try again." }, 500);
  }

  const actionLink = linkData?.properties?.action_link;
  if (!actionLink) return json({ error: "Unable to sign in right now. Please try again." }, 500);

  let finalLink = actionLink;
  const parsed = new URL(actionLink);
  parsed.searchParams.set("redirect_to", callbackUrl);
  finalLink = parsed.toString();

  return json({ allowed: true, redirectTo: finalLink });
});

authRoutes.get("/callback", async () => {
  return json({ ok: true });
});
