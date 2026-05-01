import test from "node:test";
import assert from "node:assert/strict";
import { recoverOrphanCreateChart } from "./message-utils.js";

test("recoverOrphanCreateChart re-executes the synthetic tool when args are present", () => {
  const orphan = {
    type: "tool-create_chart",
    state: "input-available",
    input: { type: "bar", title: "Crime", xField: "category", yFields: ["count"], data: [{ category: "x", count: 1 }] },
    toolCallId: "call_123",
  };
  const fakeExecute = (input: unknown) => ({ ok: true, echoedInput: input });
  const { parts, recoveredCount } = recoverOrphanCreateChart([orphan], "create_chart", fakeExecute);
  assert.equal(recoveredCount, 1);
  const recovered = parts[0] as Record<string, unknown>;
  assert.equal(recovered.state, "output-available");
  assert.deepEqual(recovered.output, { ok: true, echoedInput: orphan.input });
});

test("recoverOrphanCreateChart leaves resolved parts untouched", () => {
  const resolved = {
    type: "tool-create_chart",
    state: "output-available",
    input: { type: "bar" },
    output: { ok: true },
    toolCallId: "call_999",
  };
  const fakeExecute = () => {
    throw new Error("should not be called");
  };
  const { parts, recoveredCount } = recoverOrphanCreateChart([resolved], "create_chart", fakeExecute);
  assert.equal(recoveredCount, 0);
  assert.deepEqual(parts[0], resolved);
});

test("recoverOrphanCreateChart skips parts of other tool types", () => {
  const orphan = {
    type: "tool-police_fetchCrimes",
    state: "input-available",
    input: { postcode: "SE1 1AA" },
    toolCallId: "call_x",
  };
  const fakeExecute = () => {
    throw new Error("should not be called");
  };
  const { parts, recoveredCount } = recoverOrphanCreateChart([orphan], "create_chart", fakeExecute);
  assert.equal(recoveredCount, 0);
  assert.deepEqual(parts[0], orphan);
});

test("recoverOrphanCreateChart silently ignores execute() throws", () => {
  const orphan = {
    type: "tool-create_chart",
    state: "input-available",
    input: { type: "bar" },
    toolCallId: "call_y",
  };
  const fakeExecute = () => {
    throw new Error("boom");
  };
  const { parts, recoveredCount } = recoverOrphanCreateChart([orphan], "create_chart", fakeExecute);
  assert.equal(recoveredCount, 0);
  assert.deepEqual(parts[0], orphan);
});
