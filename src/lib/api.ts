import { supabase } from "@/lib/supabase";
import { pushToast } from "@/lib/toast";
import { createApiClient } from "@/lib/api-core";

export { ApiError, SessionExpiredError, createApiClient } from "@/lib/api-core";
export type { ApiDeps, ApiFetchInit } from "@/lib/api-core";

const defaultClient = createApiClient({
  fetch: (...args) => fetch(...args),
  getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
  refreshAccessToken: async () => {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) return null;
    return data.session?.access_token ?? null;
  },
  signOut: async () => {
    await supabase.auth.signOut();
  },
  notify: (toast) => pushToast(toast),
});

export const apiFetch = defaultClient.apiFetch;
export const apiFetchJson = defaultClient.apiFetchJson;
