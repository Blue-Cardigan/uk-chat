import test from "node:test";
import assert from "node:assert/strict";
import { resolveCsrfPolicy } from "./worker.js";

test("resolveCsrfPolicy: skips safe methods", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    const policy = resolveCsrfPolicy({
      method,
      requestUrl: "https://app.example.com/api/chat",
      appUrl: "https://app.example.com",
      inviteAppUrl: undefined,
    });
    assert.equal(policy.kind, "skip");
  }
});

test("resolveCsrfPolicy: skips cron paths (HMAC-authenticated)", () => {
  const policy = resolveCsrfPolicy({
    method: "POST",
    requestUrl: "https://app.example.com/api/cron/data-retention",
    appUrl: "https://app.example.com",
    inviteAppUrl: undefined,
  });
  assert.equal(policy.kind, "skip");
});

test("resolveCsrfPolicy: loopback request gets loopback policy", () => {
  const policy = resolveCsrfPolicy({
    method: "POST",
    requestUrl: "http://localhost:3000/api/chat",
    appUrl: undefined,
    inviteAppUrl: undefined,
  });
  assert.equal(policy.kind, "loopback");
});

test("resolveCsrfPolicy: prod request without APP_URL is misconfigured (fails closed)", () => {
  const policy = resolveCsrfPolicy({
    method: "POST",
    requestUrl: "https://app.example.com/api/chat",
    appUrl: undefined,
    inviteAppUrl: undefined,
  });
  assert.equal(policy.kind, "misconfigured");
});

test("resolveCsrfPolicy: APP_URL becomes allowlist origin", () => {
  const policy = resolveCsrfPolicy({
    method: "POST",
    requestUrl: "https://app.example.com/api/chat",
    appUrl: "https://app.example.com",
    inviteAppUrl: undefined,
  });
  assert.equal(policy.kind, "allowlist");
  if (policy.kind !== "allowlist") return;
  assert.deepEqual(policy.origins, ["https://app.example.com"]);
});

test("resolveCsrfPolicy: INVITE_APP_URL adds a second allowlist entry", () => {
  const policy = resolveCsrfPolicy({
    method: "POST",
    requestUrl: "https://app.example.com/api/chat",
    appUrl: "https://app.example.com",
    inviteAppUrl: "https://invite.example.com",
  });
  assert.equal(policy.kind, "allowlist");
  if (policy.kind !== "allowlist") return;
  assert.deepEqual(
    [...policy.origins].sort(),
    ["https://app.example.com", "https://invite.example.com"],
  );
});

test("resolveCsrfPolicy: invalid APP_URL is treated as missing", () => {
  const policy = resolveCsrfPolicy({
    method: "POST",
    requestUrl: "https://app.example.com/api/chat",
    appUrl: "not a url",
    inviteAppUrl: undefined,
  });
  assert.equal(policy.kind, "misconfigured");
});

test("resolveCsrfPolicy: 127.0.0.1 also counts as loopback", () => {
  const policy = resolveCsrfPolicy({
    method: "POST",
    requestUrl: "http://127.0.0.1:8787/api/chat",
    appUrl: undefined,
    inviteAppUrl: undefined,
  });
  assert.equal(policy.kind, "loopback");
});
