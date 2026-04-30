import test from "node:test";
import assert from "node:assert/strict";
import { isMcpUnauthorized } from "./mcp.js";

test("isMcpUnauthorized matches explicit 401 / unauthorized strings", () => {
  assert.equal(
    isMcpUnauthorized([{ type: "sse", url: "x", error: "HTTP 401 Unauthorized" }]),
    true,
  );
  assert.equal(
    isMcpUnauthorized([{ type: "http", url: "x", error: "Unauthorized" }]),
    true,
  );
});

test("isMcpUnauthorized does NOT treat 'Failed to parse server response' as auth failure", () => {
  // The AI SDK raises this string for schema-mismatch on tools/list too —
  // matching it as auth would trigger pointless token rotations.
  assert.equal(
    isMcpUnauthorized([{ type: "sse", url: "x", error: "Failed to parse server response" }]),
    false,
  );
});

test("isMcpUnauthorized does not match unrelated transport errors", () => {
  assert.equal(
    isMcpUnauthorized([
      { type: "http", url: "x", error: "POSTing to endpoint (HTTP 404)" },
      { type: "http", url: "y", error: "Parse error: Invalid JSON" },
    ]),
    false,
  );
});
