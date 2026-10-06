import { site } from "@/lib/site"

export interface BenchmarkData {
  version: 1
  commits: Commit[]
  /** By OS: the runner of each commit, null where the OS has no run. */
  runners: Record<string, (Runner | null)[]>
  /** By OS, package, benchmark and unit: the value at each commit, or null. */
  series: Record<string, Record<string, Record<string, Record<string, (number | null)[]>>>>
}

export interface Commit {
  sha: string
  date: string
  message: string
}

export interface Runner {
  arch: string
  cpu: string
  go: string
}

/** Where the page reads the results: defaults to local /data/benchmarks-latest.json */
export const dataUrl: string =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_BENCHMARKS_URL) ||
  "/data/benchmarks-latest.json"

export const workflowUrl = `${site.repo}/actions/workflows/bench.yml`

export async function getBenchmarkDocs(): Promise<Record<string, string>> {
  return appDocs
}

export const platforms = [
  { id: "darwin", label: "macOS" },
  { id: "linux", label: "Linux" },
  { id: "windows", label: "Windows" },
] as const

export type Platform = (typeof platforms)[number]["id"]

export const metrics = [
  { id: "time", unit: "ns/op", label: "Time", text: "time per operation" },
  { id: "memory", unit: "B/op", label: "Memory", text: "memory allocated per operation" },
  { id: "allocs", unit: "allocs/op", label: "Allocations", text: "allocations per operation" },
] as const

export type Metric = (typeof metrics)[number]["id"]

export const ranges = [50, 100, 300] as const

export interface Group {
  pkg: string
  title: string
  text: string
  unit?: string
  unitText?: string
  info?: { terms: [string, string][]; note?: string }
}

export const groups: Group[] = [
  {
    pkg: "micro",
    title: "Micro-benchmarks",
    text: "Context creation, direct vs proxy action dispatch, Zod input validation, JSON serialization, and resource pagination.",
    info: {
      terms: [
        ["dispatch.direct", "Zero-overhead monomorphic dispatch path"],
        ["dispatch.proxy", "Typed proxy with validation and error interceptors"],
        ["json.serialize", "Pre-compiled high-throughput JSON encoder"],
      ],
      note: "Measured using Bun high-resolution nanosecond timers over 100,000 iterations per scenario.",
    },
  },
  {
    pkg: "http",
    title: "HTTP Throughput & Latency",
    text: "Elysia AOT routing vs native Bun server, SQLite CRUD, stream pipelining, and synthetic latency.",
    info: {
      terms: [
        ["http.get.json", "Fixed payload baseline measuring pure HTTP parsing and serialization"],
        ["http.sqlite.crud", "Round-trip transaction including index lookup and write-ahead log write"],
        ["http.stream.10mb", "Bounded memory backpressure stream pipeline"],
      ],
      note: "Closed-loop benchmark on loopback TCP with concurrency c=64.",
    },
  },
  {
    pkg: "prepared",
    title: "Drizzle ORM & Prepared SQL",
    text: "Dynamic Drizzle ORM query compilation vs pre-compiled prepared queries vs raw SQLite driver.",
    info: {
      terms: [
        ["dynamic", "Query AST constructed and parameterized on every call"],
        ["prepared", "Pre-compiled SQL statement cached across calls"],
        ["raw", "Direct zero-overhead C driver binding"],
      ],
    },
  },
  {
    pkg: "batch",
    title: "Batch & Background Compute",
    text: "1M row validation, bounded JSONL streaming, chunked bulk writes, and Worker thread compute.",
  },
  {
    pkg: "startup",
    title: "Cold Boot & First Request",
    text: "Repeated in-process build, route compilation, and first-request timing across 10, 100, and 1000 actions.",
    unit: "ms",
    unitText: "milliseconds",
  },
  {
    pkg: "memory",
    title: "Idle Memory Footprint",
    text: "Resident Set Size (RSS) and heap footprint after initialization and garbage collection.",
    unit: "B",
    unitText: "bytes",
    info: {
      terms: [
        ["macOS", "Physical footprint, as Activity Monitor reports it."],
        ["Linux", "Proportional set size (PSS) and dirty pages."],
        ["Windows", "Private working set."],
      ],
      note: "Measured 6 seconds after initialization with zero active HTTP requests.",
    },
  },
]

export const appDocs: Record<string, string> = {
  "micro/context.empty": "Context object creation and dependency injection container initialization.",
  "micro/action.call.sync": "Direct in-memory synchronous action dispatch without HTTP wrapper overhead.",
  "micro/action.call.async": "Asynchronous action invocation with microtask event-loop resolution.",
  "micro/action.validate.zod": "Schema validation and parsing for 20-field typed input objects.",
  "micro/dispatch.direct": "Zero-overhead direct action routing with monomorphic call sites.",
  "micro/dispatch.proxy": "Typed proxy dispatch with runtime signature reflection and error boundary.",
  "micro/json.serialize.fast": "AOT optimized JSON serialization compared to standard JSON.stringify.",
  "micro/resource.list.1k": "In-memory cursor slicing and projection for 1,000 entity rows.",

  "http/http.get.json": "AOT route handler returning small static JSON payload over loopback TCP.",
  "http/http.post.echo": "POST payload parsing, body validation, and echo response serialization.",
  "http/http.sqlite.crud": "Single HTTP request executing SQLite index lookup, update, and commit.",
  "http/http.sqlite.list100": "Paged SQLite query returning 100 hydrated objects with relations.",
  "http/http.stream.10mb": "Bounded 64KB chunk streaming through Elysia transform pipeline.",
  "http/http.wal.flush": "Disk-backed WAL sync latency under concurrent simulated write pressure.",

  "prepared/drizzle.get.dynamic": "Dynamic Drizzle query builder compiling AST on every invocation.",
  "prepared/drizzle.get.prepared": "Pre-compiled Drizzle prepared query with parameterized placeholders.",
  "prepared/sql.get.raw": "Direct bun:sqlite prepared statement with zero-copy row reader.",
  "prepared/drizzle.insert.dynamic": "Dynamic INSERT statement generation and execution.",
  "prepared/drizzle.insert.prepared": "Prepared parameterized batch INSERT statement execution.",
  "prepared/sql.insert.raw": "Raw C-binding SQLite driver batch INSERT statement.",

  "batch/batch.validate.1m": "Synchronous validation throughput over 1,000,000 input records.",
  "batch/batch.jsonl.parse": "Streaming parser reading 100MB JSONL in bounded 4MB chunks.",
  "batch/batch.bulk.write": "Transaction batch committing 10,000 rows into indexed tables.",
  "batch/batch.worker.compute": "Thread-pool message serialization and Worker CPU task execution.",

  "startup/startup.10actions": "Full platform boot, schema registration, and first request (10 actions).",
  "startup/startup.100actions": "Full platform boot, schema registration, and first request (100 actions).",
  "startup/startup.1000actions": "Full platform boot, schema registration, and first request (1000 actions).",

  "memory/rss.idle": "Resident Set Size (RSS) 10 seconds after server initialization.",
  "memory/heap.idle": "Allocated JSC heap memory after quiescent garbage collection.",
}

export const reading: NonNullable<Group["info"]> = {
  terms: [
    ["▲ ▼", "A commit that moved a result beyond its noise: worse, better."],
    ["Card", "The last value, against the first ones shown."],
    ["Gray", "Timings on other CPUs: runners get one of several, so timings compare only on the same one."],
  ],
}

export function unitLabel(unit: string) {
  const metric = metrics.find((m) => m.unit === unit)
  return metric ? metric.label.toLowerCase() : unit === "bytes" ? "size" : unit === "B" ? "idle" : unit
}

function minChange(unit: string) {
  return unit === "ns/op" ? 0.05 : unit === "bytes" ? 0.002 : 0.01
}

function minDelta(unit: string) {
  return unit === "B/op" ? 16 : unit === "allocs/op" ? 1 : unit === "B" ? 64 << 10 : 0
}

function noiseOf(values: number[], unit: string) {
  let noise = minChange(unit)
  const m = median(values)
  if (values.length >= 5 && m > 0) {
    noise = Math.max(noise, (5 * median(values.map((v) => Math.abs(v - m)))) / m)
    if (values.length < 15) noise = Math.max(noise, (Math.max(...values) - Math.min(...values)) / m)
  }
  return noise
}

function ratio(after: number, before: number) {
  return before > 0 ? after / before - 1 : after === 0 ? 0 : Infinity
}

export interface Step {
  index: number
  before: number
  after: number
  change: number
}

export function findSteps(values: (number | null)[], unit: string, runners: (Runner | null)[]): Step[] {
  if (unit !== "ns/op") return stepsOf(values, unit)
  const cpus = new Set(runners.flatMap((r) => (r ? [r.cpu] : [])))
  return [...cpus].flatMap((cpu) => stepsOf(onCPU(values, runners, cpu), unit)).sort((a, b) => a.index - b.index)
}

export function onCPU(values: (number | null)[], runners: (Runner | null), cpu: string | undefined): (number | null)[]
export function onCPU(values: (number | null)[], runners: (Runner | null)[], cpu: string | undefined): (number | null)[]
export function onCPU(values: (number | null)[], runners: (Runner | null)[] | (Runner | null), cpu: string | undefined) {
  const list = Array.isArray(runners) ? runners : [runners]
  return values.map((v, i) => (list[i]?.cpu === cpu ? v : null))
}

function stepsOf(values: (number | null)[], unit: string): Step[] {
  const at = values.flatMap((v, i) => (v == null ? [] : [i]))
  const v = (k: number) => values[at[k]!]!
  const steps: Step[] = []
  let level = 0
  let run: { step: Step; jump: number; k: number } | undefined
  const end = () => {
    if (!run) return
    steps.push(run.step)
    level = run.k
    run = undefined
  }
  for (let k = 5; k < at.length; k++) {
    if (k - level < 5) continue
    const i = at[k]!
    const before = at.slice(Math.max(level, k - 20), k).map((j) => values[j]!)
    const noise = noiseOf(before, unit)
    const b = median(before.slice(-5))
    const a = median(at.slice(k, k + 5).map((j) => values[j]!))
    const change = ratio(a, b)
    const own = ratio(v(k), b)
    const steady = Math.max(...before) - Math.min(...before) <= minChange(unit) * b
    const small = Math.abs(a - b) < minDelta(unit) || Math.abs(v(k) - b) < minDelta(unit)
    const unconfirmed = !steady && (before.length < 10 || at.length - k < 3)
    if (small || unconfirmed || Math.abs(change) <= noise || Math.abs(own) <= noise || Math.sign(change) !== Math.sign(own)) {
      end()
      continue
    }
    const jump = Math.abs(v(k) - v(k - 1)) / Math.max(b, Number.MIN_VALUE)
    if (!run || jump > run.jump) run = { step: { index: i, before: b, after: a, change }, jump, k }
  }
  end()
  return steps
}

export interface Trend {
  latest: number
  index: number
  start?: number
  change?: number
  noise: number
  significant: boolean
  steps: Step[]
}

export function trendOf(values: (number | null)[], unit: string, runners: (Runner | null)[], from: number): Trend | undefined {
  let index = values.length - 1
  while (index >= 0 && values[index] == null) index--
  if (index < 0) return undefined
  const latest = values[index]!
  const nonNull = (v: number | null): v is number => v != null
  const like = unit === "ns/op" ? onCPU(values, runners, runners[index]?.cpu) : values
  const noise = noiseOf(like.slice(0, index).filter(nonNull).slice(-20), unit)
  const shown = like.slice(from, index).filter(nonNull)
  const steps = findSteps(values, unit, runners).filter((s) => s.index >= from)
  if (!shown.length) return { latest, index, noise, significant: false, steps }
  const start = median(shown.slice(0, 5))
  const change = ratio(latest, start)
  const history = like.slice(0, index).filter(nonNull).slice(-20)
  const steady = history.length > 0 && Math.max(...history) - Math.min(...history) <= minChange(unit) * median(history)
  const known = shown.length >= 5 && history.length >= (steady ? 5 : 10)
  const significant = known && Math.abs(change) > noise && Math.abs(latest - start) >= minDelta(unit)
  return { latest, index, start, change, noise, significant, steps }
}

export function shortCPU(cpu: string) {
  return cpu
    .replace(/\((R|TM)\)/gi, "")
    .replace(/\b(AMD|Intel|CPU|Processor|\d+-Core)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function lastValue(values: (number | null)[]) {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return values[i]!
  return undefined
}

export function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

function sig(v: number) {
  return v >= 100 ? Math.round(v).toLocaleString("en-US") : String(Number(v.toPrecision(3)))
}

export function formatValue(v: number, unit: string) {
  switch (unit) {
    case "ns/op":
      if (v >= 1e9) return `${sig(v / 1e9)} s`
      if (v >= 1e6) return `${sig(v / 1e6)} ms`
      if (v >= 1e3) return `${sig(v / 1e3)} µs`
      return `${sig(v)} ns`
    case "ms":
      if (v >= 1e3) return `${sig(v / 1e3)} s`
      return `${sig(v)} ms`
    case "B/op":
    case "bytes":
    case "B":
      if (v >= 1e9) return `${sig(v / 1e9)} GB`
      if (v >= 1e6) return `${sig(v / 1e6)} MB`
      if (v >= 1e3) return `${sig(v / 1e3)} kB`
      return `${sig(v)} B`
    case "allocs/op":
      return `${Number.isInteger(v) ? v.toLocaleString("en-US") : sig(v)} ${v === 1 ? "alloc" : "allocs"}`
    default:
      return `${sig(v)} ${unit}`
  }
}

export function formatChange(change: number) {
  if (change === Infinity) return "from 0"
  if (change >= 9) return `${(change + 1).toFixed(change >= 99 ? 0 : 1)}×`
  const pct = Math.abs(change * 100)
  const digits = pct < 10 ? 1 : 0
  return `${change < 0 ? "−" : "+"}${pct.toFixed(digits)}%`
}

export function formatDate(iso: string, withYear = false) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) })
}

export function commitUrl(sha: string) {
  return `${site.repo}/commit/${sha}`
}

export function anchorOf(pkg: string, name: string) {
  return `${pkg === "." ? "brick" : pkg}/${name}`.replace(/[^\w-]+/g, "-")
}
