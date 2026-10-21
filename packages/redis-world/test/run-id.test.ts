import { decodeTime, isValid } from "ulid";
import { describe, expect, test } from "vitest";
import { createRunId, initialMessageKey } from "../src/run-id.js";

describe("createRunId", () => {
  const time = Date.UTC(2026, 9, 17, 12, 30, 0);

  test("without a runKey it is a fresh ULID each time", () => {
    const first = createRunId();
    const second = createRunId({});
    expect(isValid(first)).toBe(true);
    expect(isValid(second)).toBe(true);
    expect(first).not.toBe(second);
  });

  test("the same runKey and runKeyTime give the same id", () => {
    const options = { runKey: "evt_1:welcome-email", runKeyTime: time };
    expect(createRunId(options)).toBe(createRunId({ ...options }));
  });

  test("the id is a valid ULID whose time is runKeyTime", () => {
    const id = createRunId({ runKey: "evt_1:welcome-email", runKeyTime: time });
    expect(id).toHaveLength(26);
    expect(isValid(id)).toBe(true);
    expect(decodeTime(id)).toBe(time);
  });

  test("different keys give different ids", () => {
    const a = createRunId({ runKey: "evt_1:a", runKeyTime: time });
    const b = createRunId({ runKey: "evt_1:b", runKeyTime: time });
    expect(a).not.toBe(b);
    expect(decodeTime(a)).toBe(decodeTime(b));
  });

  test("a different time gives a different id for the same key", () => {
    const a = createRunId({ runKey: "evt_1:a", runKeyTime: time });
    const b = createRunId({ runKey: "evt_1:a", runKeyTime: time + 1 });
    expect(a).not.toBe(b);
  });

  test("accepts the first and the last moment a ULID can hold", () => {
    expect(isValid(createRunId({ runKey: "k", runKeyTime: 0 }))).toBe(true);
    expect(isValid(createRunId({ runKey: "k", runKeyTime: 2 ** 48 - 1 }))).toBe(
      true,
    );
  });

  test.each([
    ["an empty key", { runKey: "", runKeyTime: time }],
    ["a key that is not a string", { runKey: 7, runKeyTime: time }],
    ["a key that is too long", { runKey: "k".repeat(1025), runKeyTime: time }],
  ])("rejects %s", (_name, options) => {
    expect(() => createRunId(options)).toThrow(/runKey must be a non-empty/);
  });

  test.each([
    ["no time", {}],
    ["a time that is not a number", { runKeyTime: "2026-10-17" }],
    ["a fractional time", { runKeyTime: time + 0.5 }],
    ["a negative time", { runKeyTime: -1 }],
    ["a time past what a ULID can hold", { runKeyTime: 2 ** 48 }],
    ["NaN", { runKeyTime: Number.NaN }],
  ])("rejects a runKey with %s", (_name, extra) => {
    expect(() => createRunId({ runKey: "k", ...extra })).toThrow(
      /runKey needs runKeyTime/,
    );
  });
});

describe("initialMessageKey", () => {
  test("keys the message that starts a run", () => {
    expect(
      initialMessageKey({
        runId: "wrun_1",
        runInput: { input: new Uint8Array() },
      }),
    ).toBe("start:wrun_1");
  });

  test.each([
    ["a message without run input", { runId: "wrun_1" }],
    ["a message without a run id", { runInput: {} }],
    ["a run id that is not a string", { runId: 1, runInput: {} }],
    ["nothing", undefined],
    ["null", null],
  ])("leaves %s alone", (_name, message) => {
    expect(initialMessageKey(message)).toBeUndefined();
  });
});
