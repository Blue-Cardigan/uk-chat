import test from "node:test";
import assert from "node:assert/strict";
import { verifyCronAuth } from "./cron.js";

const SECRET = "test-cron-secret";
const METHOD = "GET";
const PATH = "/api/cron/data-retention";

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

test("verifyCronAuth: accepts a valid signature", async () => {
  const now = Date.now();
  const ts = String(now);
  const sig = await sign(SECRET, `${METHOD}\n${PATH}\n${ts}`);
  const result = await verifyCronAuth({
    secret: SECRET,
    method: METHOD,
    path: PATH,
    authorizationHeader: `Bearer ${sig}`,
    timestampHeader: ts,
    now,
  });
  assert.equal(result, "ok");
});

test("verifyCronAuth: rejects when secret missing", async () => {
  const result = await verifyCronAuth({
    secret: undefined,
    method: METHOD,
    path: PATH,
    authorizationHeader: "Bearer abc",
    timestampHeader: String(Date.now()),
  });
  assert.equal(result, "misconfigured");
});

test("verifyCronAuth: rejects when authorization header missing", async () => {
  const result = await verifyCronAuth({
    secret: SECRET,
    method: METHOD,
    path: PATH,
    authorizationHeader: null,
    timestampHeader: String(Date.now()),
  });
  assert.equal(result, "unauthorized");
});

test("verifyCronAuth: rejects when timestamp header missing", async () => {
  const result = await verifyCronAuth({
    secret: SECRET,
    method: METHOD,
    path: PATH,
    authorizationHeader: "Bearer abc",
    timestampHeader: null,
  });
  assert.equal(result, "unauthorized");
});

test("verifyCronAuth: rejects when timestamp skew exceeds 5 minutes", async () => {
  const now = Date.now();
  const stale = now - 6 * 60 * 1000;
  const ts = String(stale);
  const sig = await sign(SECRET, `${METHOD}\n${PATH}\n${ts}`);
  const result = await verifyCronAuth({
    secret: SECRET,
    method: METHOD,
    path: PATH,
    authorizationHeader: `Bearer ${sig}`,
    timestampHeader: ts,
    now,
  });
  assert.equal(result, "unauthorized");
});

test("verifyCronAuth: accepts seconds-precision timestamps", async () => {
  const nowMs = Date.now();
  const seconds = Math.floor(nowMs / 1000);
  const ts = String(seconds);
  const sig = await sign(SECRET, `${METHOD}\n${PATH}\n${ts}`);
  const result = await verifyCronAuth({
    secret: SECRET,
    method: METHOD,
    path: PATH,
    authorizationHeader: `Bearer ${sig}`,
    timestampHeader: ts,
    now: nowMs,
  });
  assert.equal(result, "ok");
});

test("verifyCronAuth: rejects signature for wrong path (path-binding)", async () => {
  const now = Date.now();
  const ts = String(now);
  const sig = await sign(SECRET, `${METHOD}\n/api/cron/other\n${ts}`);
  const result = await verifyCronAuth({
    secret: SECRET,
    method: METHOD,
    path: PATH,
    authorizationHeader: `Bearer ${sig}`,
    timestampHeader: ts,
    now,
  });
  assert.equal(result, "unauthorized");
});

test("verifyCronAuth: rejects signature signed with a different secret", async () => {
  const now = Date.now();
  const ts = String(now);
  const sig = await sign("attacker-secret", `${METHOD}\n${PATH}\n${ts}`);
  const result = await verifyCronAuth({
    secret: SECRET,
    method: METHOD,
    path: PATH,
    authorizationHeader: `Bearer ${sig}`,
    timestampHeader: ts,
    now,
  });
  assert.equal(result, "unauthorized");
});

test("verifyCronAuth: rejects malformed (non-hex) signature", async () => {
  const now = Date.now();
  const ts = String(now);
  const result = await verifyCronAuth({
    secret: SECRET,
    method: METHOD,
    path: PATH,
    authorizationHeader: "Bearer not-hex-XYZ!",
    timestampHeader: ts,
    now,
  });
  assert.equal(result, "unauthorized");
});

test("verifyCronAuth: rejects non-numeric timestamp", async () => {
  const result = await verifyCronAuth({
    secret: SECRET,
    method: METHOD,
    path: PATH,
    authorizationHeader: "Bearer abc",
    timestampHeader: "not-a-number",
  });
  assert.equal(result, "unauthorized");
});
