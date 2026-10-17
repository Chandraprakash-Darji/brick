import { describe, expect, it } from "bun:test";
import {
  fromInputValue,
  presetWindow,
  toInputValue,
  windowFromInputs,
} from "../dashboard/time-range";

describe("toInputValue and fromInputValue", () => {
  it("write and read local time to the second", () => {
    const ms = new Date(2026, 9, 17, 8, 5, 9, 456).getTime();
    expect(toInputValue(ms)).toBe("2026-10-17T08:05:09");
    expect(fromInputValue("2026-10-17T08:05:09")).toBe(
      new Date(2026, 9, 17, 8, 5, 9).getTime(),
    );
    // A browser leaves the seconds off when they are zero.
    expect(fromInputValue("2026-10-17T08:05")).toBe(
      new Date(2026, 9, 17, 8, 5).getTime(),
    );
  });

  it("reads nothing from a blank or malformed value", () => {
    expect(fromInputValue("")).toBeUndefined();
    expect(fromInputValue("2026-10-17")).toBeUndefined();
    expect(fromInputValue("yesterday")).toBeUndefined();
    expect(fromInputValue("2026-13-45T25:61")).toBeUndefined();
  });
});

describe("windowFromInputs", () => {
  it("takes the end as the end of its second", () => {
    const result = windowFromInputs(
      "2026-10-17T08:00:00",
      "2026-10-17T08:00:05",
    );
    expect(result).toEqual({
      window: {
        from: new Date(2026, 9, 17, 8, 0, 0).getTime(),
        to: new Date(2026, 9, 17, 8, 0, 5, 999).getTime(),
      },
    });
  });

  it("says what is wrong when the inputs cannot make a window", () => {
    expect(windowFromInputs("", "2026-10-17T08:00")).toEqual({
      problem: "Choose both a start and an end.",
    });
    expect(windowFromInputs("2026-10-17T09:00", "2026-10-17T08:00")).toEqual({
      problem: "The start must be before the end.",
    });
    expect(windowFromInputs("2026-10-17T08:00", "2026-10-17T08:00")).toEqual({
      problem: "The start must be before the end.",
    });
  });
});

describe("presetWindow", () => {
  const now = new Date(2026, 9, 17, 15, 30, 0).getTime();

  it("covers the last quarter hour up to now", () => {
    expect(presetWindow("15m", now)).toEqual({ from: now - 900_000, to: now });
  });

  it("covers today from midnight, and yesterday midnight to midnight", () => {
    expect(presetWindow("today", now)).toEqual({
      from: new Date(2026, 9, 17).getTime(),
      to: now,
    });
    expect(presetWindow("yesterday", now)).toEqual({
      from: new Date(2026, 9, 16).getTime(),
      to: new Date(2026, 9, 17).getTime() - 1,
    });
  });

  it("keeps yesterday a calendar day across a month change", () => {
    const first = new Date(2026, 10, 1, 9, 0, 0).getTime();
    expect(presetWindow("yesterday", first).from).toBe(
      new Date(2026, 9, 31).getTime(),
    );
  });
});
