import { onboardUser } from "../_lib/onboarding";
import { ensureAdminOrBootstrap, json } from "../_lib/server";

type OnboardBody = {
  email?: string;
  sendEmail?: boolean;
  token?: string;
  rotateToken?: boolean;
};

export async function POST(request: Request) {
  const auth = await ensureAdminOrBootstrap(request);
  if ("error" in auth) return auth.error;

  const body = (await request.json()) as OnboardBody;
  if (!body.email) {
    return json({ error: "Email is required" }, 400);
  }

  try {
    const result = await onboardUser({
      email: body.email,
      sendEmail: body.sendEmail,
      token: body.token,
      rotateToken: body.rotateToken,
    });
    return json({
      message: "User onboarding completed",
      user: {
        email: result.email,
        status: "invited",
        hasToken: Boolean(result.token),
      },
      meta: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Onboarding failed";
    return json({ error: message }, 400);
  }
}
