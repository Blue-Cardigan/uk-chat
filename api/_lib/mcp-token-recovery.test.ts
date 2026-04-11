import test from "node:test";
import assert from "node:assert/strict";
import { shouldClearPendingMcpToken } from "./mcp-token-recovery.js";

test("clears pending token when it matches attempted token", () => {
  const shouldClear = shouldClearPendingMcpToken({
    pendingToken: "stale-token",
    attemptedTokens: ["stale-token", "other-token"],
  });
  assert.equal(shouldClear, true);
});

test("keeps pending token when it was not attempted", () => {
  const shouldClear = shouldClearPendingMcpToken({
    pendingToken: "new-token",
    attemptedTokens: ["stale-token"],
  });
  assert.equal(shouldClear, false);
});

test("does not clear when pending token is absent", () => {
  const shouldClear = shouldClearPendingMcpToken({
    pendingToken: null,
    attemptedTokens: ["stale-token"],
  });
  assert.equal(shouldClear, false);
});
