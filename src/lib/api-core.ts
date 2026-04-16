import { safeJson, type ApiErrorPayload } from "./http";

export type ApiFetchInit = RequestInit & {
  skipAuth?: boolean;
  skipToast?: boolean;
  /** Disable the one-shot 401 refresh+retry. */
  skipRefresh?: boolean;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string,
    public readonly body: ApiErrorPayload | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class SessionExpiredError extends ApiError {
  constructor(message = "Your session has expired. Please sign in again.") {
    super(401, "SESSION_EXPIRED", message, null);
    this.name = "SessionExpiredError";
  }
}

export type ToastKind = "info" | "success" | "warning" | "error";

export type ApiDeps = {
  fetch: typeof fetch;
  getAccessToken: () => Promise<string | null>;
  refreshAccessToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
  notify: (toast: { kind: ToastKind; message: string }) => void;
};

export function createApiClient(deps: ApiDeps) {
  async function apiFetch(input: RequestInfo | URL, init: ApiFetchInit = {}): Promise<Response> {
    const { skipAuth, skipToast, skipRefresh, ...rawInit } = init;
    const endpoint = describeEndpoint(input);
    const hasJsonBody = typeof rawInit.body === "string";

    let token: string | null = null;
    if (!skipAuth) {
      token = await deps.getAccessToken();
    }

    const execute = (authToken: string | null): Promise<Response> =>
      deps.fetch(input, { ...rawInit, headers: mergeAuthHeaders(rawInit, authToken, hasJsonBody) });

    let response = await execute(token);

    if (response.status === 401 && !skipAuth && !skipRefresh) {
      const refreshed = await deps.refreshAccessToken();
      // Skip retry if refresh returned the same token — server already rejected it.
      if (refreshed && refreshed !== token) {
        response = await execute(refreshed);
      }
      if (response.status === 401) {
        await deps.signOut();
        if (!skipToast) {
          deps.notify({ kind: "error", message: "Your session expired — please sign in again." });
        }
        throw new SessionExpiredError();
      }
    }

    if (response.status === 429) {
      const retryAfterRaw = response.headers.get("Retry-After");
      const retryAfter = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : NaN;
      const suffix = Number.isFinite(retryAfter) && retryAfter > 0 ? ` Try again in ${retryAfter}s.` : "";
      if (!skipToast) {
        deps.notify({ kind: "warning", message: `Too many requests.${suffix}` });
      }
      throw await buildApiError(response, endpoint);
    }

    if (response.status >= 500) {
      if (!skipToast) {
        deps.notify({ kind: "error", message: "Something went wrong on our end. Please retry." });
      }
      throw await buildApiError(response, endpoint);
    }

    if (!response.ok) {
      throw await buildApiError(response, endpoint);
    }

    return response;
  }

  // Throws ApiError on empty/invalid JSON bodies. Callers that may receive
  // empty 2xx responses (e.g., PATCH with no body) should use `apiFetch` and
  // skip `.json()`, or pass `allowEmpty: true` to get `null` back.
  async function apiFetchJson<T>(
    input: RequestInfo | URL,
    init: ApiFetchInit & { allowEmpty?: false },
  ): Promise<T>;
  async function apiFetchJson<T>(
    input: RequestInfo | URL,
    init: ApiFetchInit & { allowEmpty: true },
  ): Promise<T | null>;
  async function apiFetchJson<T>(input: RequestInfo | URL, init?: ApiFetchInit): Promise<T>;
  async function apiFetchJson<T>(
    input: RequestInfo | URL,
    init: ApiFetchInit & { allowEmpty?: boolean } = {},
  ): Promise<T | null> {
    const { allowEmpty, ...fetchInit } = init;
    const response = await apiFetch(input, fetchInit);
    const parsed = await safeJson<T>(response);
    if (parsed === null && !allowEmpty) {
      throw new ApiError(response.status, null, `Expected JSON response from ${describeEndpoint(input)}`);
    }
    return parsed;
  }

  return { apiFetch, apiFetchJson };
}

function mergeAuthHeaders(init: RequestInit | undefined, token: string | null, hasJsonBody: boolean): Headers {
  const headers = new Headers(init?.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (hasJsonBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

function describeEndpoint(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.pathname;
  return input.url;
}

async function buildApiError(response: Response, endpoint: string): Promise<ApiError> {
  const body = (await safeJson<ApiErrorPayload>(response)) ?? null;
  const code = body?.code ?? null;
  const message = body?.error ?? `Request to ${endpoint} failed with ${response.status}`;
  return new ApiError(response.status, code, message, body);
}
