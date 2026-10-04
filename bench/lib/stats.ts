/** Shared statistics helpers for the Brick benchmark lab. */

export interface LatencySummary {
  count: number;
  min_ms: number;
  p50_ms: number;
  p90_ms: number;
  p95_ms: number;
  p99_ms: number;
  p999_ms: number;
  max_ms: number;
  mean_ms: number;
}

/** Percentile of a sorted array (linear interpolation). */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

export function summarize(latenciesMs: number[]): LatencySummary {
  if (latenciesMs.length === 0) {
    return { count: 0, min_ms: 0, p50_ms: 0, p90_ms: 0, p95_ms: 0, p99_ms: 0, p999_ms: 0, max_ms: 0, mean_ms: 0 };
  }
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    min_ms: round3(sorted[0]!),
    p50_ms: round3(percentile(sorted, 50)),
    p90_ms: round3(percentile(sorted, 90)),
    p95_ms: round3(percentile(sorted, 95)),
    p99_ms: round3(percentile(sorted, 99)),
    p999_ms: round3(percentile(sorted, 99.9)),
    max_ms: round3(sorted[sorted.length - 1]!),
    mean_ms: round3(sum / sorted.length),
  };
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Median of numbers. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

export function fmtMs(ms: number): string {
  if (ms < 0.001) return `${(ms * 1e6).toFixed(1)}ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(1)}µs`;
  return `${ms.toFixed(3)}ms`;
}

export function fmtNs(ns: number): string {
  if (ns < 1000) return `${ns.toFixed(1)}ns`;
  if (ns < 1e6) return `${(ns / 1000).toFixed(2)}µs`;
  return `${(ns / 1e6).toFixed(3)}ms`;
}

export function fmtRps(rps: number): string {
  if (rps >= 1e6) return `${(rps / 1e6).toFixed(2)}M`;
  if (rps >= 1000) return `${(rps / 1000).toFixed(2)}k`;
  return rps.toFixed(1);
}

/** Minimal CLI arg parser: --key value, --key=value, --flag. */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (!tok.startsWith("--")) continue;
    const eq = tok.indexOf("=");
    if (eq !== -1) {
      out[tok.slice(2, eq)] = tok.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
      out[tok.slice(2)] = argv[++i]!;
    } else {
      out[tok.slice(2)] = true;
    }
  }
  return out;
}

export function argInt(args: Record<string, string | boolean>, key: string, fallback: number): number {
  const v = args[key];
  if (v === undefined || v === true) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export function argStr(args: Record<string, string | boolean>, key: string, fallback: string): string {
  const v = args[key];
  if (v === undefined || v === true) return fallback;
  return String(v);
}

export function argList(args: Record<string, string | boolean>, key: string, fallback: number[]): number[] {
  const v = args[key];
  if (v === undefined || v === true) return fallback;
  return String(v)
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}
