import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, SessionExpiredError, createApiClient, type ApiDeps, type ToastKind } from "./api-core";

type Notification = { kind: ToastKind; message: string };

function buildDeps(overrides: Partial<ApiDeps> = {}): { deps: ApiDeps; notifications: Notification[]; signOuts: number } {
  const notifications: Notification[] = [];
  let signOuts = 0;
  const deps: ApiDeps = {
    fetch: overrides.fetch ?? (async () => new Response(null, { status: 200 })),
    getAccessToken: overrides.getAccessToken ?? (async () => "tok-1"),
    refreshAccessToken: overrides.refreshAccessToken ?? (async () => null),
    signOut: overrides.signOut ?? (async () => { signOuts += 1; }),
    notify: overrides.notify ?? ((toast) => notifications.push(toast)),
  };
  return { deps, notifications, signOuts: 0 + signOuts };
}

test("apiFetch attaches Authorization header and JSON content-type", async () => {
  let capturedHeaders: Headers | null = null;
  const { deps } = buildDeps({
    fetch: async (_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  const { apiFetch } = createApiClient(deps);
  await apiFetch("/api/thing", { method: "POST", body: JSON.stringify({ a: 1 }) });
  assert.equal(capturedHeaders!.get("Authorization"), "Bearer tok-1");
  assert.equal(capturedHeaders!.get("Content-Type"), "application/json");
});

test("apiFetch refreshes and retries once on 401", async () => {
  let attempt = 0;
  const seenTokens: (string | null)[] = [];
  const notifications: Notification[] = [];
  const deps: ApiDeps = {
    fetch: async (_input, init) => {
      attempt += 1;
      const headers = new Headers(init?.headers);
      seenTokens.push(headers.get("Authorization"));
      if (attempt === 1) return new Response(null, { status: 401 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    getAccessToken: async () => "old",
    refreshAccessToken: async () => "fresh",
    signOut: async () => { throw new Error("should not sign out"); },
    notify: (toast) => notifications.push(toast),
  };
  const { apiFetch } = createApiClient(deps);
  const res = await apiFetch("/api/foo");
  assert.equal(res.status, 200);
  assert.equal(attempt, 2);
  assert.deepEqual(seenTokens, ["Bearer old", "Bearer fresh"]);
  assert.equal(notifications.length, 0);
});

test("apiFetch signs out and throws SessionExpiredError when refresh fails", async () => {
  let signOuts = 0;
  const notifications: Notification[] = [];
  const deps: ApiDeps = {
    fetch: async () => new Response(null, { status: 401 }),
    getAccessToken: async () => "old",
    refreshAccessToken: async () => null,
    signOut: async () => { signOuts += 1; },
    notify: (toast) => notifications.push(toast),
  };
  const { apiFetch } = createApiClient(deps);
  await assert.rejects(() => apiFetch("/api/foo"), SessionExpiredError);
  assert.equal(signOuts, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.kind, "error");
});

test("apiFetch throws ApiError and toasts on 429 with Retry-After", async () => {
  const notifications: Notification[] = [];
  const deps: ApiDeps = {
    fetch: async () =>
      new Response(JSON.stringify({ error: "slow down" }), {
        status: 429,
        headers: { "Retry-After": "12", "Content-Type": "application/json" },
      }),
    getAccessToken: async () => "tok",
    refreshAccessToken: async () => null,
    signOut: async () => {},
    notify: (toast) => notifications.push(toast),
  };
  const { apiFetch } = createApiClient(deps);
  await assert.rejects(
    () => apiFetch("/api/foo"),
    (err) => err instanceof ApiError && err.status === 429,
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.kind, "warning");
  assert.match(notifications[0]!.message, /12s/);
});

test("apiFetch throws ApiError and toasts on 5xx", async () => {
  const notifications: Notification[] = [];
  const deps: ApiDeps = {
    fetch: async () => new Response(JSON.stringify({ error: "boom" }), { status: 503, headers: { "Content-Type": "application/json" } }),
    getAccessToken: async () => "tok",
    refreshAccessToken: async () => null,
    signOut: async () => {},
    notify: (toast) => notifications.push(toast),
  };
  const { apiFetch } = createApiClient(deps);
  await assert.rejects(
    () => apiFetch("/api/foo"),
    (err) => err instanceof ApiError && err.status === 503 && err.body?.error === "boom",
  );
  assert.equal(notifications[0]?.kind, "error");
});

test("apiFetch preserves error code in ApiError body for non-OK JSON responses", async () => {
  const deps: ApiDeps = {
    fetch: async () =>
      new Response(JSON.stringify({ error: "mcp bad", code: "MCP_TOKEN_UNAUTHORIZED" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    getAccessToken: async () => "tok",
    refreshAccessToken: async () => null,
    signOut: async () => {},
    notify: () => {},
  };
  const { apiFetch } = createApiClient(deps);
  await assert.rejects(
    () => apiFetch("/api/foo"),
    (err) => err instanceof ApiError && err.code === "MCP_TOKEN_UNAUTHORIZED" && err.status === 400,
  );
});

test("apiFetch suppresses toasts when skipToast is set", async () => {
  const notifications: Notification[] = [];
  const deps: ApiDeps = {
    fetch: async () => new Response(null, { status: 500 }),
    getAccessToken: async () => "tok",
    refreshAccessToken: async () => null,
    signOut: async () => {},
    notify: (toast) => notifications.push(toast),
  };
  const { apiFetch } = createApiClient(deps);
  await assert.rejects(() => apiFetch("/api/foo", { skipToast: true }), ApiError);
  assert.equal(notifications.length, 0);
});

test("apiFetch with skipAuth does not attach Authorization or retry on 401", async () => {
  let calls = 0;
  let observedAuth: string | null = "unset";
  const deps: ApiDeps = {
    fetch: async (_input, init) => {
      calls += 1;
      observedAuth = new Headers(init?.headers).get("Authorization");
      return new Response(null, { status: 401 });
    },
    getAccessToken: async () => { throw new Error("should not be called"); },
    refreshAccessToken: async () => { throw new Error("should not be called"); },
    signOut: async () => { throw new Error("should not be called"); },
    notify: () => {},
  };
  const { apiFetch } = createApiClient(deps);
  await assert.rejects(
    () => apiFetch("/api/public", { skipAuth: true }),
    (err) => err instanceof ApiError && err.status === 401 && !(err instanceof SessionExpiredError),
  );
  assert.equal(calls, 1);
  assert.equal(observedAuth, null);
});

test("apiFetch with skipRefresh signs out immediately without calling refreshAccessToken", async () => {
  let refreshCalls = 0;
  let signOuts = 0;
  const deps: ApiDeps = {
    fetch: async () => new Response(null, { status: 401 }),
    getAccessToken: async () => "tok",
    refreshAccessToken: async () => { refreshCalls += 1; return "fresh"; },
    signOut: async () => { signOuts += 1; },
    notify: () => {},
  };
  const { apiFetch } = createApiClient(deps);
  await assert.rejects(() => apiFetch("/api/foo", { skipRefresh: true }), ApiError);
  assert.equal(refreshCalls, 0);
  assert.equal(signOuts, 0);
});

test("apiFetch signs out when refresh returns the same token", async () => {
  let fetchCalls = 0;
  let signOuts = 0;
  const deps: ApiDeps = {
    fetch: async () => { fetchCalls += 1; return new Response(null, { status: 401 }); },
    getAccessToken: async () => "same",
    refreshAccessToken: async () => "same",
    signOut: async () => { signOuts += 1; },
    notify: () => {},
  };
  const { apiFetch } = createApiClient(deps);
  await assert.rejects(() => apiFetch("/api/foo"), SessionExpiredError);
  assert.equal(fetchCalls, 1);
  assert.equal(signOuts, 1);
});

test("apiFetch does not set Content-Type when body is undefined or FormData", async () => {
  const captured: Array<string | null> = [];
  const deps: ApiDeps = {
    fetch: async (_input, init) => {
      captured.push(new Headers(init?.headers).get("Content-Type"));
      return new Response(null, { status: 200 });
    },
    getAccessToken: async () => "tok",
    refreshAccessToken: async () => null,
    signOut: async () => {},
    notify: () => {},
  };
  const { apiFetch } = createApiClient(deps);
  await apiFetch("/api/a");
  const formData = new FormData();
  formData.set("k", "v");
  await apiFetch("/api/b", { method: "POST", body: formData });
  assert.equal(captured[0], null);
  assert.equal(captured[1], null);
});

test("apiFetchJson with allowEmpty returns null on empty body", async () => {
  const deps: ApiDeps = {
    fetch: async () => new Response("", { status: 200 }),
    getAccessToken: async () => "tok",
    refreshAccessToken: async () => null,
    signOut: async () => {},
    notify: () => {},
  };
  const { apiFetchJson } = createApiClient(deps);
  const data = await apiFetchJson<{ x: number }>("/api/foo", { allowEmpty: true });
  assert.equal(data, null);
});

test("apiFetchJson returns parsed JSON for 2xx responses", async () => {
  const deps: ApiDeps = {
    fetch: async () => new Response(JSON.stringify({ hello: "world" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    getAccessToken: async () => null,
    refreshAccessToken: async () => null,
    signOut: async () => {},
    notify: () => {},
  };
  const { apiFetchJson } = createApiClient(deps);
  const data = await apiFetchJson<{ hello: string }>("/api/foo", { skipAuth: true });
  assert.equal(data.hello, "world");
});
