import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { latest, medians, merge, normalize, type Snapshot } from "./history";

test("exports measured goodput, latency and RSS without inventing allocations", () => {
  const result = normalize("http", {
    results: [
      {
        name: "get c=16",
        goodput_rps: 900,
        rps: 1000,
        latency: { p99_ms: 2 },
        rss_mb_mean: 3,
        rss_mb_peak: 4,
      },
    ],
  });
  expect(result.http["get c=16"]).toEqual({
    "req/s": 900,
    ms: 2,
    B: 3 * 1024 * 1024,
  });
  expect(result.http["get c=16.rss-peak"]).toEqual({ B: 4 * 1024 * 1024 });
  expect(
    normalize("micro", {
      results: [
        {
          benchmark: "context",
          variant: "empty",
          ns_per_op: 80,
          heap_delta_bytes_per_op: -16,
        },
      ],
    }).micro["context.empty"],
  ).toEqual({ "ns/op": 80, "B/op": -16 });
  expect(
    normalize("prepared", {
      rows: [{ op: "get", variant: "prepared", us_per_query: 3 }],
    }).prepared["get.prepared"],
  ).toEqual({ "ns/op": 3000 });
});

test("medians ignore missing samples instead of treating them as zero", () => {
  expect(
    medians([
      { http: { get: { "req/s": 100, ms: 3 } } },
      { http: { get: { "req/s": 200 } } },
      { http: { get: { "req/s": 300, ms: 5 } } },
    ]),
  ).toEqual({ http: { get: { "req/s": 200, ms: 4 } } });
});

test("series align commits with missing OS and newly introduced cases", () => {
  const run = {
    arch: "arm64",
    cpu: "CPU",
    runtime: "bun-1.4.2",
    measuredAt: "2026-10-07T00:00:00Z",
    count: 6,
    skipped: [],
    failures: [],
    results: { compiler: { get: { "req/s": 100 } } },
  };
  const data = latest([
    {
      sha: "b",
      date: "2026-10-07T00:00:00Z",
      message: "second",
      runs: { linux: run },
    },
    {
      sha: "a",
      date: "2026-10-06T00:00:00Z",
      message: "first",
      runs: { darwin: run },
    },
  ]);
  expect(data.commits.map((commit) => commit.sha)).toEqual(["a", "b"]);
  expect(data.series.darwin.compiler.get["req/s"]).toEqual([100, null]);
  expect(data.series.linux.compiler.get["req/s"]).toEqual([null, 100]);
  expect(data.runners.linux[0]).toBeNull();
});

test("merging a retry preserves other platforms and rejects older measurements", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brick-history-"));
  const snapshot: Snapshot = {
    sha: "a".repeat(40),
    date: "2026-10-07T00:00:00Z",
    message: "change",
    os: "darwin",
    arch: "arm64",
    cpu: "CPU",
    runtime: "bun-1.4.2",
    measuredAt: "2026-10-07T02:00:00Z",
    count: 6,
    results: { compiler: { get: { "req/s": 200 } } },
    skipped: [],
    failures: [],
  };
  try {
    const first = join(dir, "darwin.json"),
      other = join(dir, "linux.json"),
      stale = join(dir, "stale.json");
    await writeFile(first, JSON.stringify(snapshot));
    await writeFile(other, JSON.stringify({ ...snapshot, os: "linux" }));
    await writeFile(
      stale,
      JSON.stringify({
        ...snapshot,
        measuredAt: "2026-10-07T01:00:00Z",
        results: {},
      }),
    );
    const output = join(dir, "published");
    await merge(output, [first, other]);
    await merge(output, [stale, first]);
    const data = JSON.parse(
      await readFile(join(output, "latest.json"), "utf8"),
    );
    expect(data.commits).toHaveLength(1);
    expect(Object.keys(data.series)).toEqual(["darwin", "linux"]);
    expect(data.series.darwin.compiler.get["req/s"]).toEqual([200]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("publishes compiled route names and server-only footprint metrics", () => {
  expect(
    normalize("compiler", {
      summary: {
        "resource-get.generic": { median_rps: 10, median_p99_ms: 8 },
        "resource-get.compiled": { median_rps: 20, median_p99_ms: 4 },
        sync: { median_rps: 30, median_p99_ms: 2 },
        architecture: { median_rps: 100000, median_p99_ms: 0.2 },
        "docs.compiled": { median_rps: 120000, median_p99_ms: 0.1 },
      },
    }).compiler,
  ).toEqual({
    "resource-get": { "req/s": 20, ms: 4 },
    sync: { "req/s": 30, ms: 2 },
  });
  expect(
    normalize("footprint", {
      summary: {
        startup_ms: 70,
        idle_cpu_ms: 8,
        idle_cpu_percent: 0.16,
        bundle_bytes: 450000,
        bundle_gzip_bytes: 130000,
      },
    }),
  ).toEqual({
    footprint: { "cold-start": { ms: 70 }, "idle-cpu": { ms: 8, "%": 0.16 } },
    bundle: {
      "server-bundle": { B: 450000 },
      "server-bundle-gzip": { B: 130000 },
    },
  });
});
