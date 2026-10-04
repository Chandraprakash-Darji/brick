/**
 * Built-in HTTP load generator (no oha/wrk dependency).
 * Closed-loop, fixed-request loader. Not an open-loop offered-rate test.
 * CPU/RSS measure the combined server + generator process in local runs.
 * If `oha`/`wrk` exist on PATH, run-all reports them as optional companions;
 * this driver is always available and is the source of recorded numbers.
 */
import { summarize, type LatencySummary } from "./stats";

export interface LoadOptions {
  url: string | (() => string);
  method?: string;
  headers?: Record<string, string>;
  body?: string | (() => string);
  concurrency: number;
  requests: number;
  timeoutMs?: number;
  /** Label for logs. */
  name?: string;
}

export interface LoadResult {
  name: string;
  url: string;
  concurrency: number;
  offered: number;
  completed: number;
  errors: number;
  timeouts: number;
  statusCodes: Record<string, number>;
  duration_s: number;
  rps: number;
  goodput_rps: number;
  latency: LatencySummary;
  latencies_ms: number[];
  successful: number;
  measurement_scope: string;
  bytes_in: number;
  bytes_out: number;
  bytes_in_per_req: number;
  cpu_ms_per_req: number;
  rss_mb_mean: number;
  rss_mb_peak: number;
  event_loop_delay_ms: number;
}

export async function runLoad(opts: LoadOptions): Promise<LoadResult> {
  for (const [key, value] of Object.entries({ requests: opts.requests, concurrency: opts.concurrency })) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer`);
  }
  const method = opts.method ?? "GET";
  const timeoutMs = opts.timeoutMs ?? 15000;
  const perWorker = Math.floor(opts.requests / opts.concurrency);
  const remainder = opts.requests % opts.concurrency;

  const latencies: number[] = [];
  let completed = 0;
  let successful = 0;
  let errors = 0;
  let timeouts = 0;
  let bytesIn = 0;
  let bytesOut = 0;
  const statusCodes: Record<string, number> = {};

  const rssStart = process.memoryUsage().rss;
  let rssPeak = rssStart;
  const rssSamples = [rssStart];
  let loopDelay = 0;
  let expectedTick = performance.now() + 10;
  const cpuStart = process.cpuUsage();
  const rssTimer = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > rssPeak) rssPeak = rss;
    rssSamples.push(rss);
  }, 50);
  const loopTimer = setInterval(() => {
    const now = performance.now();
    loopDelay = Math.max(loopDelay, now - expectedTick);
    expectedTick = now + 10;
  }, 10);
  const t0 = performance.now();

  const worker = async (n: number) => {
    for (let i = 0; i < n; i++) {
      const url = typeof opts.url === "function" ? opts.url() : opts.url;
      const body = typeof opts.body === "function" ? opts.body() : opts.body;
      if (body && method !== "GET" && method !== "HEAD") bytesOut += Buffer.byteLength(body);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const start = performance.now();
      try {
        const res = await fetch(url, {
          method,
          headers: opts.headers,
          body: method === "GET" || method === "HEAD" ? undefined : body,
          signal: ctrl.signal,
        });
        let responseBytes = 0;
        if (res.body) {
          for await (const chunk of res.body) responseBytes += chunk.byteLength;
        }
        latencies.push(performance.now() - start);
        bytesIn += responseBytes;
        completed++;
        const k = String(res.status);
        statusCodes[k] = (statusCodes[k] ?? 0) + 1;
        if (res.ok) successful++;
        else errors++;
      } catch (err: unknown) {
        latencies.push(performance.now() - start);
        if (ctrl.signal.aborted) timeouts++;
        errors++;
      } finally {
        clearTimeout(timer);
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let w = 0; w < opts.concurrency; w++) {
    workers.push(worker(perWorker + (w < remainder ? 1 : 0)));
  }
  await Promise.all(workers);

  const durationS = (performance.now() - t0) / 1000;
  clearInterval(rssTimer);
  clearInterval(loopTimer);
  const cpuDiff = process.cpuUsage(cpuStart);
  const cpuMs = (cpuDiff.user + cpuDiff.system) / 1000;
  const rssEnd = process.memoryUsage().rss;
  rssSamples.push(rssEnd);
  rssPeak = Math.max(rssPeak, rssEnd);

  return {
    name: opts.name ?? `${method} ${typeof opts.url === "function" ? "<dynamic-url>" : opts.url}`,
    url: typeof opts.url === "function" ? "<dynamic-url>" : opts.url,
    concurrency: opts.concurrency,
    offered: opts.requests,
    completed,
    errors,
    timeouts,
    statusCodes,
    duration_s: Math.round(durationS * 1000) / 1000,
    rps: Math.round((completed / durationS) * 100) / 100,
    goodput_rps: Math.round((successful / durationS) * 100) / 100,
    latency: summarize(latencies),
    latencies_ms: latencies,
    successful,
    measurement_scope: "closed-loop; CPU/RSS/event-loop: combined local server + generator process; bytes: body only",
    bytes_in: bytesIn,
    bytes_out: bytesOut,
    bytes_in_per_req: completed > 0 ? Math.round((bytesIn / completed) * 10) / 10 : 0,
    cpu_ms_per_req: completed > 0 ? Math.round((cpuMs / completed) * 1000) / 1000 : 0,
    rss_mb_mean: Math.round((rssSamples.reduce((a, b) => a + b, 0) / rssSamples.length / 1024 ** 2) * 100) / 100,
    rss_mb_peak: Math.round((rssPeak / 1024 ** 2) * 100) / 100,
    event_loop_delay_ms: Math.round(Math.max(0, loopDelay) * 1000) / 1000,
  };
}

/** Check for optional external load tools (oha/wrk/hyperfine/perf). */
export async function externalTools(): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const t of ["oha", "wrk", "hyperfine", "perf"]) {
    try {
      const p = Bun.spawnSync(["which", t]);
      out[t] = p.exitCode === 0;
    } catch {
      out[t] = false;
    }
  }
  return out;
}
