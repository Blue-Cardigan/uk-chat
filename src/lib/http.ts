export async function safeJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export type ApiErrorPayload = { error?: string; code?: string };

export async function readApiError(response: Response): Promise<ApiErrorPayload> {
  return (await safeJson<ApiErrorPayload>(response)) ?? {};
}
