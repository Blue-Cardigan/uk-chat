import test from "node:test";
import assert from "node:assert/strict";
import { runChatWithFallback, type TryStream, type TryStreamOptions } from "./chat-fallback.js";

type Call = TryStreamOptions & { _index: number };

function makeTimeoutError(): Error {
  const error = new Error("provider timed out");
  return error;
}

function makeInvalidRequestError(): Error {
  const error = Object.assign(new Error("invalid_request: bad schema"), {
    statusCode: 400,
  });
  return error;
}

function makeUnrelatedError(): Error {
  return new Error("something else entirely");
}

function buildRunner(behaviors: Array<Error | "ok">) {
  const calls: Call[] = [];
  const sentinel = { __stream: true } as unknown;
  const tryStream: TryStream = ((options: TryStreamOptions) => {
    const index = calls.length;
    calls.push({ ...options, _index: index });
    const behavior = behaviors[index];
    if (behavior === "ok" || behavior === undefined) return sentinel as ReturnType<TryStream>;
    throw behavior;
  }) as TryStream;
  return { tryStream, calls, sentinel };
}

type Overrides = Partial<Parameters<typeof runChatWithFallback>[0]> & { behaviors?: Array<Error | "ok"> };

function baseParams(overrides: Overrides = {}) {
  const telemetry: Record<string, unknown> = (overrides.telemetry as Record<string, unknown>) ?? {};
  const { tryStream, calls, sentinel } = buildRunner(overrides.behaviors ?? ["ok"]);
  const { behaviors: _b, telemetry: _t, tryStream: _ts, ...rest } = overrides;
  void _b;
  void _t;
  void _ts;
  const params = {
    tryStream: overrides.tryStream ?? tryStream,
    primary: {
      includeFallbackModels: true,
      includeTools: true,
      requireToolCall: true,
    },
    requireDataToolCall: true,
    quantitativeSafeTools: { safe: {} } as never,
    quantitativeReducedSafeTools: { reduced: {} } as never,
    systemPrompt: "SYS",
    quantMainStepLimit: 6,
    modelId: "pro",
    providerModel: "google/gemini-2.5-pro",
    telemetry,
    ...rest,
  };
  return { params, calls, telemetry, sentinel };
}

function run(overrides: Overrides) {
  const { params, calls, telemetry, sentinel } = baseParams(overrides);
  const result = runChatWithFallback(params);
  return { result, calls, telemetry, sentinel };
}

test("primary success: no fallbackPath override and returns primary result", () => {
  const { result, calls, telemetry, sentinel } = run({ behaviors: ["ok"] });
  assert.equal(result, sentinel);
  assert.equal(calls.length, 1);
  assert.equal(telemetry.fallbackPath, "none");
});

test("unrelated error rethrows without mutating telemetry further", () => {
  const { tryStream } = buildRunner([makeUnrelatedError()]);
  const { params } = baseParams({ tryStream });
  assert.throws(() => runChatWithFallback(params), /something else/);
});

test("timeout quantitative: reduced_tools succeeds on retry", () => {
  const { calls, telemetry } = run({ behaviors: [makeTimeoutError(), "ok"] });
  assert.equal(calls.length, 2);
  assert.equal(telemetry.fallbackPath, "timeout_reduced_tools");
  assert.equal(calls[1].includeTools, true);
  assert.equal(calls[1].requireToolCall, true);
  assert.ok(calls[1].toolsOverride);
  assert.equal(calls[1].stepLimitOverride, 4);
});

test("timeout quantitative: double timeout falls to bounded_synthesis", () => {
  const { calls, telemetry } = run({ behaviors: [makeTimeoutError(), makeTimeoutError(), "ok"] });
  assert.equal(calls.length, 3);
  assert.equal(telemetry.fallbackPath, "timeout_bounded_synthesis");
  assert.equal(calls[2].includeTools, false);
  assert.equal(calls[2].requireToolCall, false);
});

test("timeout quantitative: retry raises unrelated error → rethrows", () => {
  const { tryStream } = buildRunner([makeTimeoutError(), makeUnrelatedError()]);
  const { params } = baseParams({ tryStream });
  assert.throws(() => runChatWithFallback(params), /something else/);
});

test("timeout non-quant: drops tools immediately", () => {
  const { calls, telemetry } = run({
    requireDataToolCall: false,
    behaviors: [makeTimeoutError(), "ok"],
  });
  assert.equal(calls.length, 2);
  assert.equal(telemetry.fallbackPath, "timeout_no_tools_non_quant");
  assert.equal(calls[1].includeTools, false);
});

test("invalid_request: no_fallback_models succeeds on first retry", () => {
  const { calls, telemetry } = run({ behaviors: [makeInvalidRequestError(), "ok"] });
  assert.equal(calls.length, 2);
  assert.equal(telemetry.fallbackPath, "no_fallback_models");
  assert.equal(calls[1].includeFallbackModels, false);
  assert.equal(calls[1].includeTools, true);
  assert.equal(calls[1].requireToolCall, true);
});

test("invalid_request non-quant: falls to no_tools_non_quant", () => {
  const { calls, telemetry } = run({
    requireDataToolCall: false,
    behaviors: [makeInvalidRequestError(), makeInvalidRequestError(), "ok"],
  });
  assert.equal(calls.length, 3);
  assert.equal(telemetry.fallbackPath, "no_tools_non_quant");
  assert.equal(calls[2].includeTools, false);
});

test("invalid_request quantitative full chain: auto_tool_choice → reduced_tools → no_tools", () => {
  const behaviors: Array<Error | "ok"> = [
    makeInvalidRequestError(), // primary
    makeInvalidRequestError(), // no_fallback_models
    makeInvalidRequestError(), // auto_tool_choice
    makeInvalidRequestError(), // reduced_tools
    "ok", // no_tools
  ];
  const { calls, telemetry } = run({ behaviors: behaviors });
  assert.equal(calls.length, 5);
  assert.equal(telemetry.fallbackPath, "no_tools");
  assert.equal(calls[2].requireToolCall, false);
  assert.equal(calls[3].requireToolCall, true);
  assert.ok(calls[3].toolsOverride);
  assert.equal(calls[4].includeTools, false);
});

test("invalid_request quantitative: reduced_tools succeeds", () => {
  const behaviors: Array<Error | "ok"> = [
    makeInvalidRequestError(),
    makeInvalidRequestError(),
    makeInvalidRequestError(),
    "ok",
  ];
  const { calls, telemetry } = run({ behaviors: behaviors });
  assert.equal(calls.length, 4);
  assert.equal(telemetry.fallbackPath, "reduced_tools");
});

test("existing telemetry.fallbackPath is not overwritten by default", () => {
  const telemetry: Record<string, unknown> = { fallbackPath: "preset" };
  const { tryStream } = buildRunner(["ok"]);
  const { params } = baseParams({ tryStream, telemetry });
  runChatWithFallback(params);
  assert.equal(telemetry.fallbackPath, "preset");
});
