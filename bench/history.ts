import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { median } from "./lib/stats";

const excludedRoutes = new Set([
  "health",
  "architecture",
  "openapi",
  "docs",
  "swagger",
  "reference",
]);

export type Results = Record<string, Record<string, Record<string, number>>>;
export interface Runner {
  arch: string;
  cpu: string;
  runtime: string;
  dirty?: boolean;
}
export interface Snapshot extends Runner {
  sha: string;
  date: string;
  message: string;
  os: string;
  measuredAt: string;
  count: number;
  suiteCounts?: Record<string, number>;
  results: Results;
  skipped: string[];
  failures: string[];
}
export interface Commit {
  sha: string;
  date: string;
  message: string;
  runs: Record<string, Omit<Snapshot, "sha" | "date" | "message" | "os">>;
}

/** Only measured metrics are exported; no allocation counts are inferred. */
export function normalize(suite: string, data: any): Results {
  const results: Results = {};
  const put = (name: string, unit: string, value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      ((results[suite] ??= {})[name] ??= {})[unit] = value;
    }
  };
  if (suite === "micro") {
    for (const row of data.results ?? []) {
      const name = `${row.benchmark}.${row.variant}`;
      put(name, "ns/op", row.ns_per_op);
      put(name, "ops/s", row.ops_per_sec);
      put(name, "B/op", row.heap_delta_bytes_per_op);
    }
  } else if (suite === "prepared") {
    for (const row of data.rows ?? [])
      put(`${row.op}.${row.variant}`, "ns/op", row.us_per_query * 1000);
  } else if (suite === "batch") {
    for (const row of data.results ?? []) {
      put(row.benchmark, "ops/s", row.records_per_sec);
      if (row.records > 0)
        put(row.benchmark, "ns/op", (row.seconds / row.records) * 1e9);
    }
  } else if (suite === "startup") {
    for (const [name, values] of Object.entries(data.summary ?? {}) as [
      string,
      any,
    ][]) {
      for (const metric of ["build_ms", "listen_ms", "first_request_ms"])
        put(
          `${name}.${metric.replace(/_ms$/, "")}`,
          "ms",
          values[metric]?.median,
        );
      put(`${name}.rss`, "B", values.rss_mb?.median * 1024 * 1024);
    }
  } else if (suite === "http" || suite === "postgres") {
    for (const row of data.results ?? []) {
      put(row.name, "req/s", row.goodput_rps);
      put(row.name, "ms", row.latency?.p99_ms);
      for (const percentile of ["p50", "p95", "p999"])
        put(
          `${row.name}.${percentile}`,
          "ms",
          row.latency?.[`${percentile}_ms`],
        );
      put(row.name, "B", row.rss_mb_mean * 1024 * 1024);
      put(`${row.name}.rss-peak`, "B", row.rss_mb_peak * 1024 * 1024);
    }
    for (const [name, value] of Object.entries(data.countLeg ?? {})) {
      if (name.endsWith("_us") && typeof value === "number")
        put(`sql.${name.replace(/_us$/, "")}`, "ms", value / 1000);
    }
  } else if (suite === "footprint") {
    put("cold-start", "ms", data.summary.startup_ms);
    put("idle-cpu", "ms", data.summary.idle_cpu_ms);
    put("idle-cpu", "%", data.summary.idle_cpu_percent);
    results.bundle = {
      "server-bundle": { B: data.summary.bundle_bytes },
      "server-bundle-gzip": { B: data.summary.bundle_gzip_bytes },
    };
  } else if (suite === "compiler") {
    for (const [name, row] of Object.entries(data.summary ?? {}) as [
      string,
      any,
    ][]) {
      if (name.endsWith(".generic")) continue;
      const route = name.replace(/\.compiled$/, "");
      if (excludedRoutes.has(route)) continue;
      put(route, "req/s", row.median_rps);
      put(route, "ms", row.median_p99_ms);
    }
  }
  return results;
}

export function medians(samples: Results[]): Results {
  const series: Record<string, Record<string, Record<string, number[]>>> = {};
  for (const sample of samples) {
    for (const [suite, cases] of Object.entries(sample)) {
      for (const [name, units] of Object.entries(cases)) {
        for (const [unit, value] of Object.entries(units))
          (((series[suite] ??= {})[name] ??= {})[unit] ??= []).push(value);
      }
    }
  }
  const results: Results = {};
  for (const [suite, cases] of Object.entries(series)) {
    for (const [name, units] of Object.entries(cases)) {
      for (const [unit, values] of Object.entries(units))
        ((results[suite] ??= {})[name] ??= {})[unit] = median(values);
    }
  }
  return results;
}

export function latest(commits: Commit[]) {
  const ordered = [...commits]
    .sort(
      (a, b) =>
        Date.parse(a.date) - Date.parse(b.date) || a.sha.localeCompare(b.sha),
    )
    .slice(-300);
  const runners: Record<string, (Runner | null)[]> = {};
  const series: Record<
    string,
    Record<string, Record<string, Record<string, (number | null)[]>>>
  > = {};
  const notes: Record<
    string,
    ({
      measuredAt: string;
      count: number;
      suiteCounts?: Record<string, number>;
      skipped: string[];
      failures: string[];
    } | null)[]
  > = {};
  ordered.forEach((commit, index) => {
    for (const [os, run] of Object.entries(commit.runs)) {
      (runners[os] ??= Array(ordered.length).fill(null))[index] = {
        arch: run.arch,
        cpu: run.cpu,
        runtime: run.runtime,
        dirty: run.dirty,
      };
      (notes[os] ??= Array(ordered.length).fill(null))[index] = {
        measuredAt: run.measuredAt,
        count: run.count,
        suiteCounts: run.suiteCounts,
        skipped: run.skipped,
        failures: run.failures,
      };
      for (const [suite, cases] of Object.entries(run.results)) {
        for (const [name, units] of Object.entries(cases)) {
          if (suite === "compiler" && name.endsWith(".generic")) continue;
          const route =
            suite === "compiler" ? name.replace(/\.compiled$/, "") : name;
          if (suite === "compiler" && excludedRoutes.has(route)) continue;
          for (const [unit, value] of Object.entries(units))
            ((((series[os] ??= {})[suite] ??= {})[route] ??= {})[unit] ??=
              Array(ordered.length).fill(null))[index] = value;
        }
      }
    }
  });
  return {
    version: 1,
    commits: ordered.map(({ sha, date, message }) => ({ sha, date, message })),
    runners,
    series,
    notes,
  };
}

/** Daily files retain every measured commit; latest.json keeps the last 300. */
export async function merge(dir: string, files: string[]) {
  const history = join(dir, "history");
  await mkdir(history, { recursive: true });
  for (const file of files) {
    const snapshot = JSON.parse(await readFile(file, "utf8")) as Snapshot;
    if (
      !/^[a-f0-9]{40}$/.test(snapshot.sha) ||
      !["darwin", "linux", "win32"].includes(snapshot.os)
    )
      throw new Error(`Invalid benchmark snapshot: ${file}`);
    const path = join(history, `${snapshot.date.slice(0, 10)}.json`);
    let commits: Commit[] = [];
    try {
      commits = JSON.parse(await readFile(path, "utf8"));
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    let commit = commits.find((item) => item.sha === snapshot.sha);
    if (!commit) {
      commit = {
        sha: snapshot.sha,
        date: snapshot.date,
        message: snapshot.message,
        runs: {},
      };
      commits.push(commit);
    }
    const { sha: _sha, date: _date, message: _message, os, ...run } = snapshot;
    if (!commit.runs[os] || commit.runs[os].measuredAt <= run.measuredAt)
      commit.runs[os] = run;
    await writeFile(path, JSON.stringify(commits, null, 2) + "\n");
  }
  const commits: Commit[] = [];
  for (const file of (await readdir(history))
    .filter((file) => file.endsWith(".json"))
    .sort())
    commits.push(...JSON.parse(await readFile(join(history, file), "utf8")));
  await writeFile(
    join(dir, "latest.json"),
    JSON.stringify(latest(commits)) + "\n",
  );
  await writeFile(
    join(dir, "README.md"),
    "# Brick benchmarks\n\nMeasured on every push to main by .github/workflows/bench.yml.\n\n- history/YYYY-MM-DD.json: measured commits and per-platform results.\n- latest.json: the latest 300 commits, read directly by the website.\n\nMissing and failed measurements are recorded rather than replaced with zero. HTTP lab CPU/RSS include the load generator. GitHub runner comparisons are exploratory.\n",
  );
}
