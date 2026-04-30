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

test("isMcpUnauthorized recognizes the AI SDK SSE 401 fingerprint", () => {
  // The AI SDK SSE transport translates a JSON 401 body into this error string.
  assert.equal(
    isMcpUnauthorized([{ type: "sse", url: "x", error: "Failed to parse server response" }]),
    true,
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
