import type { Env } from "../env.js";
import { getSupabaseAdmin } from "./server.js";

export async function writeAdminAuditLog(
  env: Env,
  input: {
    actorUserId?: string | null;
    actorEmail?: string | null;
    action: string;
    target?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const supabase = getSupabaseAdmin(env);
  await supabase.from("uk_chat_admin_audit_log").insert({
    actor_user_id: input.actorUserId ?? null,
    actor_email: input.actorEmail ?? null,
    action: input.action,
    target: input.target ?? null,
    metadata: input.metadata ?? {},
  });
}
