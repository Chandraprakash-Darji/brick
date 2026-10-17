import { describe, expect, it } from "bun:test";
import { formatAxis, formatPercent } from "../dashboard/format";
import { RANGES, rangeMs } from "../dashboard/history";

describe("history ranges", () => {
  it("run from short to long, ending at ninety days", () => {
    const spans = RANGES.map((range) => range.ms);
    expect([...spans].sort((a, b) => a - b)).toEqual(spans);
    expect(RANGES[RANGES.length - 1].value).toBe("90d");
  });

  it("looks up a range's length", () => {
    expect(rangeMs("1h")).toBe(3_600_000);
    expect(rangeMs("90d")).toBe(90 * 86_400_000);
  });
});

describe("history formatting", () => {
  it("shows a rate as a percentage without a trailing zero", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.025)).toBe("2.5%");
    expect(formatPercent(0.5)).toBe("50%");
  });

  it("labels a chart axis with the time for a day and the date beyond", () => {
    const at = new Date(2026, 2, 4, 14, 5).getTime();
    expect(formatAxis(at, 24 * 3_600_000)).toMatch(/14:05|2:05/);
    expect(formatAxis(at, 7 * 24 * 3_600_000)).toMatch(/Mar.*4|4.*Mar/);
  });
});
