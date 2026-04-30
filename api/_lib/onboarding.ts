import type { Env } from "../env.js";
import { getSupabaseAdmin } from "./server.js";

type OnboardUserInput = {
  email: string;
  sendEmail?: boolean;
  token?: string;
  rotateToken?: boolean;
  appUrl?: string;
};

type OnboardUserResult = {
  email: string;
  status: "created" | "updated" | "unchanged";
  token: string | null;
  tokenIssued: boolean;
  emailSent: boolean;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export async function issueMcpToken(email: string, env: Env, options: { rotate?: boolean } = {}) {
  const issueUrl = env.MCP_TOKEN_ISSUE_URL ?? "https://mcp.explorethekingdom.co.uk/api/tokens";
  const issueSecret = env.MCP_TOKEN_ISSUE_SECRET ?? "";
  const response = await fetch(issueUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(issueSecret ? { Authorization: `Bearer ${issueSecret}` } : {}),
    },
    body: JSON.stringify({ email, rotate: options.rotate === true }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Token issuing failed (${response.status}): unauthorized issuer request. Check MCP_TOKEN_ISSUE_SECRET for ${issueUrl}.`,
      );
    }
    throw new Error(`Token issuing failed (${response.status})${body ? `: ${body}` : ""}`);
  }
  const payload = (await response.json()) as { token?: string };
  if (!payload.token) {
    throw new Error("Token issuing returned no token");
  }
  return payload.token;
}

async function createMagicLink(email: string, env: Env, appUrlOverride?: string) {
  const supabase = getSupabaseAdmin(env);
  const appUrl = (appUrlOverride ?? env.INVITE_APP_URL ?? env.APP_URL ?? "https://chatgb.co.uk").trim();
  if (!appUrl) {
    throw new Error("A valid invite app URL must be set before sending onboarding emails.");
  }

  let redirectTo: string;
  try {
    const parsed = new URL(appUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Invite app URL must use http or https.");
    }
    if (isLoopbackHostname(parsed.hostname)) {
      throw new Error("Invite app URL must not be a localhost/loopback URL when sending onboarding emails.");
    }
    redirectTo = `${parsed.origin}/auth/callback`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invite app URL is invalid.";
    throw new Error(`Invalid invite URL configuration: ${message}`);
  }

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  if (error) {
    throw new Error(`Failed to generate magic link: ${error.message}`);
  }
  const actionLink = data?.properties?.action_link;
  if (!actionLink) {
    throw new Error("Supabase did not return an action link");
  }
  return actionLink;
}

async function sendResendMagicLink(email: string, actionLink: string, env: Env) {
  const resendApiKey = env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is required to send onboarding emails");
  }
  const from = env.RESEND_FROM_EMAIL ?? "UK Chat <onboarding@resend.dev>";
  const subject = "Your ChatGB sign-in link";
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#111;">
      <h2 style="margin:0 0 12px;">Welcome to ChatGB</h2>
      <p style="margin:0 0 12px;">Your account has been enabled. Use the link below to sign in:</p>
      <p style="margin:0 0 16px;">
        <a href="${actionLink}" style="display:inline-block;padding:10px 14px;background:#111;color:#fff;text-decoration:none;border-radius:8px;">Sign in to ChatGB</a>
      </p>
      <p style="margin:0 0 8px;font-size:12px;color:#555;">If the button does not work, paste this URL in your browser:</p>
      <p style="margin:0;font-size:12px;word-break:break-all;color:#555;">${actionLink}</p>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject,
      html,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "Failed to send onboarding email");
  }
}

export async function onboardUser(input: OnboardUserInput, env: Env): Promise<OnboardUserResult> {
  const email = normalizeEmail(input.email);
  const shouldSendEmail = input.sendEmail ?? true;
  const rotateToken = input.rotateToken ?? false;
  const supabase = getSupabaseAdmin(env);

  const { data: existing, error: existingError } = await supabase
    .from("uk_chat_email_gate")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to read email gate: ${existingError.message}`);
  }

  let status: OnboardUserResult["status"] = existing ? "unchanged" : "created";
  if (!existing) {
    const { error: insertError } = await supabase.from("uk_chat_email_gate").insert({ email });
    if (insertError) {
      throw new Error(`Failed to create email gate row: ${insertError.message}`);
    }
  }

  // Token issuance is delegated to the canonical issuer, which is idempotent
  // unless rotate is requested. We no longer cache tokens in email_gate.
  let token: string | null = null;
  let tokenIssued = false;
  if (typeof input.token === "string") {
    token = input.token;
  } else {
    token = await issueMcpToken(email, env, { rotate: rotateToken });
    tokenIssued = true;
  }

  let emailSent = false;
  if (shouldSendEmail) {
    const actionLink = await createMagicLink(email, env, input.appUrl);
    await sendResendMagicLink(email, actionLink, env);
    emailSent = true;
  }

  return {
    email,
    status,
    token,
    tokenIssued,
    emailSent,
  };
}
