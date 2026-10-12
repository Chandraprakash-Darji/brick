import { describe, it, expect } from "bun:test";
import { parsePort } from "../src/port-utils";

describe("parsePort", () => {
  it("should use default port 4000 when no arguments provided", () => {
    expect(parsePort(undefined, undefined)).toBe(4000);
  });

  it("should prefer CLI port over environment port", () => {
    expect(parsePort("5000", "3000")).toBe(5000);
  });

  it("should use environment port when CLI port not provided", () => {
    expect(parsePort(undefined, "3000")).toBe(3000);
  });

  it("should reject PORT=0 from environment", () => {
    expect(() => parsePort(undefined, "0")).toThrow(/invalid|port/i);
  });

  it("should use default 4000 when invalid env port provided", () => {
    expect(() => parsePort(undefined, "invalid")).toThrow(/invalid|port/i);
  });

  it("should accept valid port 1", () => {
    expect(parsePort("1", undefined)).toBe(1);
  });

  it("should accept valid port 80", () => {
    expect(parsePort("80", undefined)).toBe(80);
  });

  it("should accept valid port 3000", () => {
    expect(parsePort("3000", undefined)).toBe(3000);
  });

  it("should accept valid port 8080", () => {
    expect(parsePort("8080", undefined)).toBe(8080);
  });

  it("should accept valid port 65535 (max valid port)", () => {
    expect(parsePort("65535", undefined)).toBe(65535);
  });

  it("should reject port 0", () => {
    expect(() => parsePort("0", undefined)).toThrow(/invalid|port/i);
  });

  it("should reject negative port", () => {
    expect(() => parsePort("-1", undefined)).toThrow(/invalid|port/i);
  });

  it("should reject port > 65535", () => {
    expect(() => parsePort("65536", undefined)).toThrow(/invalid|port/i);
  });

  it("should reject port > 65535 (large number)", () => {
    expect(() => parsePort("99999", undefined)).toThrow(/invalid|port/i);
  });

  it("should reject non-integer port", () => {
    expect(() => parsePort("abc", undefined)).toThrow(/invalid|port/i);
  });

  it("should reject float port", () => {
    expect(() => parsePort("3000.5", undefined)).toThrow(/invalid|port/i);
  });

  it("should reject empty string port", () => {
    expect(() => parsePort("", undefined)).toThrow(/invalid|port/i);
  });
});
