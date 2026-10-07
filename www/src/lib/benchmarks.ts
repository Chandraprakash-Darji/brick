import { site } from "@/lib/site";

export interface BenchmarkData {
  version: 1;
  commits: Commit[];
  /** By OS: the runner of each commit, null where the OS has no run. */
  runners: Record<string, (Runner | null)[]>;
  /** By OS, package, benchmark and unit: the value at each commit, or null. */
  series: Record<
    string,
    Record<string, Record<string, Record<string, (number | null)[]>>>
  >;
  notes?: Record<
    string,
    ({
      measuredAt: string;
      count: number;
      suiteCounts?: Record<string, number>;
      skipped: string[];
      failures: string[];
    } | null)[]
  >;
}

export interface Commit {
  sha: string;
  date: string;
  message: string;
}

export interface Runner {
  arch: string;
  cpu: string;
  runtime: string;
  dirty?: boolean;
}

/** Production fetches the data branch directly; dev uses the real local snapshot. */
export const dataUrl: string =
  import.meta.env.VITE_BENCHMARKS_URL ||
  (import.meta.env.DEV
    ? "/data/benchmarks-latest.json"
    : "https://raw.githubusercontent.com/brick-org/brick/benchmarks/latest.json");

export const workflowUrl = `${site.repo}/actions/workflows/bench.yml`;

export async function getBenchmarkDocs(): Promise<Record<string, string>> {
  return appDocs;
}

export const platforms = [
  { id: "darwin", label: "macOS" },
  { id: "linux", label: "Linux" },
  { id: "win32", label: "Windows" },
] as const;

export type Platform = (typeof platforms)[number]["id"];

export const metrics = [
  { id: "time", unit: "ns/op", label: "Time", text: "duration" },
  {
    id: "throughput",
    unit: "ops/s",
    label: "Throughput",
    text: "operations per second",
  },
  { id: "memory", unit: "B/op", label: "Memory", text: "measured memory" },
] as const;

export type Metric = (typeof metrics)[number]["id"];
export const ranges = [50, 100, 300] as const;

export interface Group {
  pkg: string;
  title: string;
  text: string;
  units?: Partial<Record<Metric, string>>;
  unitText?: string;
  info?: { terms: [string, string][]; note?: string };
}

export const groups: Group[] = [
  {
    pkg: "compiler",
    title: "Brick Routes",
    text: "Action and resource CRUD routes using compiled execution. Time shows median p99; throughput shows median requests per second.",
    units: { time: "ms", throughput: "req/s" },
    info: {
      terms: [
        ["resource-*", "SQLite resource routes"],
        ["p99", "99th percentile request latency"],
      ],
      note: "External oha, concurrency 16, 50,000 requests per case, six rounds in CI. DELETE uses unique URLs with the Bun loader.",
    },
  },
  {
    pkg: "footprint",
    title: "Cold Startup & Idle CPU",
    text: "Cold process launch to listening and server CPU time while idle for five seconds, measured in fresh child processes.",
    units: { time: "ms", throughput: "ms", memory: "ms" },
  },
  {
    pkg: "bundle",
    title: "Server Bundle Size",
    text: "Minified runnable showcase HTTP server with dependencies bundled for Bun; built-in Bun modules stay external. Raw and gzip sizes.",
    units: { time: "B", throughput: "B", memory: "B" },
  },
  {
    pkg: "micro",
    title: "Micro-benchmarks",
    text: "Context creation, TypeBox validation, action dispatch, input assembly, cursor encoding, resource parsing and JSON serialization. Memory is net live heap change per operation, not allocated bytes.",
  },
  {
    pkg: "http",
    title: "HTTP Throughput & Latency",
    text: "Bun and Elysia floors, Brick framework layers, SQLite CRUD, payloads, streams and synthetic RTT. Time is p99 unless a percentile or SQL duration is named; memory is combined server and load-generator RSS.",
    units: { time: "ms", throughput: "req/s", memory: "B" },
    info: {
      terms: [
        ["req/s", "Successful requests per second (goodput)"],
        ["p99", "99th percentile request latency"],
        ["c=N", "Concurrent requests in the closed-loop loader"],
      ],
      note: "Same-process server and generator. CPU/RSS include both. Shared GitHub runners are exploratory measurements, not production capacity or dedicated-hardware gates.",
    },
  },
  {
    pkg: "prepared",
    title: "Drizzle & Prepared SQL",
    text: "SQLite get, list, insert, update and delete using dynamic Drizzle, prepared Drizzle and raw SQL.",
  },
  {
    pkg: "batch",
    title: "Batch Processing",
    text: "Validation, JSONL streaming, bulk writes, CPU and I/O transforms and worker tasks. Duration is elapsed time per record.",
  },
  {
    pkg: "startup",
    title: "Startup & First Request",
    text: "Build, listen and first-request medians for 10, 100 and 1,000 actions. RSS includes the application process after startup.",
    units: { time: "ms", throughput: "ms", memory: "B" },
  },
  {
    pkg: "postgres",
    title: "PostgreSQL CRUD",
    text: "Disposable PostgreSQL CRUD benchmark on the Linux runner. Time is p99 unless a percentile is named; throughput is successful requests per second.",
    units: { time: "ms", throughput: "req/s", memory: "B" },
  },
];

export const appDocs: Record<string, string> = {};

export const reading: NonNullable<Group["info"]> = {
  terms: [
    ["Throughput", "Higher is better; time and memory are lower-is-better"],
    [
      "Card",
      "The latest value compared with the first values shown on the same CPU",
    ],
    ["Gray", "Runs on other CPUs, excluded from the displayed comparison"],
  ],
  note: "CI uses six rounds. Local snapshots and partial or failed runs are labeled. Raw suite artifacts are retained in the workflow; compact history is published to the benchmarks branch.",
};

export function isWorse(change: number, unit: string) {
  return unit === "req/s" || unit === "ops/s" ? change < 0 : change > 0;
}

export function metricOf(unit: string): Metric | undefined {
  if (unit === "ns/op" || unit === "ms") return "time";
  if (unit === "req/s" || unit === "ops/s") return "throughput";
  if (unit === "B/op" || unit === "B") return "memory";
}

export function unitLabel(unit: string) {
  const metric = metrics.find((m) => m.id === metricOf(unit));
  return metric ? metric.label.toLowerCase() : unit;
}

function minChange(unit: string) {
  return unit === "ns/op" ? 0.05 : unit === "bytes" ? 0.002 : 0.01;
}

function minDelta(unit: string) {
  return unit === "B/op"
    ? 16
    : unit === "allocs/op"
      ? 1
      : unit === "B"
        ? 64 << 10
        : 0;
}

function noiseOf(values: number[], unit: string) {
  let noise = minChange(unit);
  const m = median(values);
  if (values.length >= 5 && m > 0) {
    noise = Math.max(
      noise,
      (5 * median(values.map((v) => Math.abs(v - m)))) / m,
    );
    if (values.length < 15)
      noise = Math.max(noise, (Math.max(...values) - Math.min(...values)) / m);
  }
  return noise;
}

function ratio(after: number, before: number) {
  return before !== 0
    ? (after - before) / Math.abs(before)
    : after === 0
      ? 0
      : Infinity;
}

export interface Step {
  index: number;
  before: number;
  after: number;
  change: number;
}

export function findSteps(
  values: (number | null)[],
  unit: string,
  runners: (Runner | null)[],
): Step[] {
  const cpus = new Set(runners.flatMap((r) => (r ? [r.cpu] : [])));
  return [...cpus]
    .flatMap((cpu) => stepsOf(onCPU(values, runners, cpu), unit))
    .sort((a, b) => a.index - b.index);
}

export function onCPU(
  values: (number | null)[],
  runners: Runner | null,
  cpu: string | undefined,
): (number | null)[];
export function onCPU(
  values: (number | null)[],
  runners: (Runner | null)[],
  cpu: string | undefined,
): (number | null)[];
export function onCPU(
  values: (number | null)[],
  runners: (Runner | null)[] | (Runner | null),
  cpu: string | undefined,
) {
  const list = Array.isArray(runners) ? runners : [runners];
  return values.map((v, i) => (list[i]?.cpu === cpu ? v : null));
}

function stepsOf(values: (number | null)[], unit: string): Step[] {
  const at = values.flatMap((v, i) => (v == null ? [] : [i]));
  const v = (k: number) => values[at[k]!]!;
  const steps: Step[] = [];
  let level = 0;
  let run: { step: Step; jump: number; k: number } | undefined;
  const end = () => {
    if (!run) return;
    steps.push(run.step);
    level = run.k;
    run = undefined;
  };
  for (let k = 5; k < at.length; k++) {
    if (k - level < 5) continue;
    const i = at[k]!;
    const before = at.slice(Math.max(level, k - 20), k).map((j) => values[j]!);
    const noise = noiseOf(before, unit);
    const b = median(before.slice(-5));
    const a = median(at.slice(k, k + 5).map((j) => values[j]!));
    const change = ratio(a, b);
    const own = ratio(v(k), b);
    const steady =
      Math.max(...before) - Math.min(...before) <= minChange(unit) * b;
    const small =
      Math.abs(a - b) < minDelta(unit) || Math.abs(v(k) - b) < minDelta(unit);
    const unconfirmed = !steady && (before.length < 10 || at.length - k < 3);
    if (
      small ||
      unconfirmed ||
      Math.abs(change) <= noise ||
      Math.abs(own) <= noise ||
      Math.sign(change) !== Math.sign(own)
    ) {
      end();
      continue;
    }
    const jump = Math.abs(v(k) - v(k - 1)) / Math.max(b, Number.MIN_VALUE);
    if (!run || jump > run.jump)
      run = { step: { index: i, before: b, after: a, change }, jump, k };
  }
  end();
  return steps;
}

export interface Trend {
  latest: number;
  index: number;
  start?: number;
  change?: number;
  noise: number;
  significant: boolean;
  steps: Step[];
}

export function trendOf(
  values: (number | null)[],
  unit: string,
  runners: (Runner | null)[],
  from: number,
): Trend | undefined {
  let index = values.length - 1;
  while (index >= 0 && values[index] == null) index--;
  if (index < 0) return undefined;
  const latest = values[index]!;
  const nonNull = (v: number | null): v is number => v != null;
  const like = onCPU(values, runners, runners[index]?.cpu);
  const noise = noiseOf(like.slice(0, index).filter(nonNull).slice(-20), unit);
  const shown = like.slice(from, index).filter(nonNull);
  const steps = findSteps(values, unit, runners).filter((s) => s.index >= from);
  if (!shown.length) return { latest, index, noise, significant: false, steps };
  const start = median(shown.slice(0, 5));
  const change = ratio(latest, start);
  const history = like.slice(0, index).filter(nonNull).slice(-20);
  const steady =
    history.length > 0 &&
    Math.max(...history) - Math.min(...history) <=
      minChange(unit) * median(history);
  const known = shown.length >= 5 && history.length >= (steady ? 5 : 10);
  const significant =
    known &&
    Math.abs(change) > noise &&
    Math.abs(latest - start) >= minDelta(unit);
  return { latest, index, start, change, noise, significant, steps };
}

export function shortCPU(cpu: string) {
  return cpu
    .replace(/\((R|TM)\)/gi, "")
    .replace(/\b(AMD|Intel|CPU|Processor|\d+-Core)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function lastValue(values: (number | null)[]) {
  for (let i = values.length - 1; i >= 0; i--)
    if (values[i] != null) return values[i]!;
  return undefined;
}

export function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function sig(v: number) {
  return v >= 100
    ? Math.round(v).toLocaleString("en-US")
    : String(Number(v.toPrecision(3)));
}

export function formatValue(v: number, unit: string) {
  switch (unit) {
    case "ns/op":
      if (v >= 1e9) return `${sig(v / 1e9)} s`;
      if (v >= 1e6) return `${sig(v / 1e6)} ms`;
      if (v >= 1e3) return `${sig(v / 1e3)} µs`;
      return `${sig(v)} ns`;
    case "ms":
      if (v >= 1e3) return `${sig(v / 1e3)} s`;
      return `${sig(v)} ms`;
    case "B/op":
    case "bytes":
    case "B":
      if (v >= 1e9) return `${sig(v / 1e9)} GB`;
      if (v >= 1e6) return `${sig(v / 1e6)} MB`;
      if (v >= 1e3) return `${sig(v / 1e3)} kB`;
      return `${sig(v)} B`;
    case "allocs/op":
      return `${Number.isInteger(v) ? v.toLocaleString("en-US") : sig(v)} ${v === 1 ? "alloc" : "allocs"}`;
    default:
      return `${sig(v)} ${unit}`;
  }
}

export function formatChange(change: number) {
  if (change === Infinity) return "from 0";
  if (change >= 9) return `${(change + 1).toFixed(change >= 99 ? 0 : 1)}×`;
  const pct = Math.abs(change * 100);
  const digits = pct < 10 ? 1 : 0;
  return `${change < 0 ? "−" : "+"}${pct.toFixed(digits)}%`;
}

export function formatDate(iso: string, withYear = false) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export function commitUrl(sha: string) {
  return `${site.repo}/commit/${sha}`;
}

export function anchorOf(pkg: string, name: string) {
  return `${pkg === "." ? "brick" : pkg}/${name}`.replace(/[^\w-]+/g, "-");
}
