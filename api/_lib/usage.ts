import { getSupabaseAdmin } from "./server.js";

export function utcDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

export function approachingThreshold(dailyLimit: number) {
  return Math.max(2, Math.ceil(dailyLimit * 0.15));
}

export async function reserveModelUsageSlot({
  supabase,
  userId,
  modelId,
  dailyLimit,
}: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  modelId: string;
  dailyLimit: number;
}) {
  const usageDate = utcDateStamp();
  const { data: existing, error: existingError } = await supabase
    .from("uk_chat_model_usage")
    .select("id,request_count")
    .eq("user_id", userId)
    .eq("model_id", modelId)
    .eq("usage_date", usageDate)
    .maybeSingle();

  if (existingError) return { ok: false as const, error: existingError.message, remaining: 0 };
  if ((existing?.request_count ?? 0) >= dailyLimit) return { ok: false as const, error: null, remaining: 0 };

  const nextCount = (existing?.request_count ?? 0) + 1;
  if (existing) {
    const { error: updateError } = await supabase
      .from("uk_chat_model_usage")
      .update({ request_count: nextCount, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updateError) return { ok: false as const, error: updateError.message, remaining: 0 };
    return { ok: true as const, error: null, remaining: Math.max(0, dailyLimit - nextCount) };
  }

  const { error: insertError } = await supabase.from("uk_chat_model_usage").insert({
    user_id: userId,
    model_id: modelId,
    usage_date: usageDate,
    request_count: 1,
  });
  if (insertError) return { ok: false as const, error: insertError.message, remaining: 0 };
  return { ok: true as const, error: null, remaining: Math.max(0, dailyLimit - 1) };
}

export async function getModelUsageStatus({
  supabase,
  userId,
  modelId,
  dailyLimit,
}: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  modelId: string;
  dailyLimit: number;
}) {
  const usageDate = utcDateStamp();
  const { data, error } = await supabase
    .from("uk_chat_model_usage")
    .select("request_count,total_prompt_tokens,total_completion_tokens,total_tool_calls")
    .eq("user_id", userId)
    .eq("model_id", modelId)
    .eq("usage_date", usageDate)
    .maybeSingle();
  if (error)
    return {
      ok: false as const,
      error: error.message,
      used: 0,
      remaining: 0,
      approaching: false,
      reached: false,
      tokens: { prompt: 0, completion: 0, total: 0 },
      toolCalls: 0,
    };
  const used = data?.request_count ?? 0;
  const remaining = Math.max(0, dailyLimit - used);
  const reached = remaining <= 0;
  const approaching = !reached && remaining <= approachingThreshold(dailyLimit);
  const promptTokens = data?.total_prompt_tokens ?? 0;
  const completionTokens = data?.total_completion_tokens ?? 0;
  return {
    ok: true as const,
    error: null,
    used,
    remaining,
    approaching,
    reached,
    tokens: { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
    toolCalls: data?.total_tool_calls ?? 0,
  };
}
