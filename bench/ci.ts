#!/usr/bin/env bun
/** Brick equivalent of MyGo's benchmark run/merge pipeline. */
import { execFileSync } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { arch, platform } from "node:os";
import { argInt, argStr, parseArgs } from "./lib/stats";
import { collectManifest, resultsDir } from "./lib/manifest";
import {
  latest,
  medians,
  merge,
  normalize,
  type Results,
  type Snapshot,
} from "./history";

const suites = [
  "micro",
  "prepared",
  "batch",
  "startup",
  "footprint",
  "http",
  "postgres",
] as const;
const root = resolve(import.meta.dir, "..");

async function run(argv: string[]) {
  const args = parseArgs(argv);
  const count = argInt(args, "rounds", 3);
  const requests = argInt(args, "requests", args.smoke ? 200 : 500);
  const compilerRequests = argInt(
    args,
    "compiler-requests",
    args.smoke ? 300 : 10000,
  );
  if (
    ![count, requests, compilerRequests].every(
      (value) => Number.isInteger(value) && value > 0,
    )
  )
    throw new Error(
      "rounds, requests and compiler-requests must be positive integers",
    );
  const out = argStr(args, "out", "");
  if (!out) throw new Error("--out is required");
  const manifest = collectManifest({ benchmark: "ci", db: "sqlite-memory" });
  const samples: Results[] = [];
  const skipped = new Set<string>();
  const failures: string[] = [];
  const measuredSuites = new Set<string>();
  const suiteCounts: Record<string, number> = {};

  async function measure(suite: string, flags: string[]) {
    await mkdir(resultsDir(), { recursive: true });
    const before = new Set(await readdir(resultsDir()));
    const proc = Bun.spawn([process.execPath, `bench/${suite}.ts`, ...flags], {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
      failures.push(`${suite}: exit ${code}`);
      return;
    }
    const files = (await readdir(resultsDir()))
      .filter(
        (file) =>
          !before.has(file) &&
          file.startsWith(`${suite}-`) &&
          file.endsWith(".json"),
      )
      .sort();
    if (!files.length) {
      failures.push(`${suite}: no result artifact`);
      return;
    }
    const data = await Bun.file(join(resultsDir(), files.at(-1)!)).json();
    if (typeof data.skipped === "string") {
      skipped.add(`${suite}: ${data.skipped}`);
      return;
    }
    for (const item of Array.isArray(data.skipped) ? data.skipped : [])
      skipped.add(`${suite}/${item.benchmark}: ${item.reason}`);
    for (const row of data.results ?? []) {
      if (row.offered && row.successful !== row.offered)
        failures.push(
          `${suite}/${row.name}: ${row.successful}/${row.offered} successful requests`,
        );
    }
    samples.push(normalize(suite, data));
    measuredSuites.add(suite);
    suiteCounts[suite] =
      (suiteCounts[suite] ?? 0) + (suite === "compiler" ? count : 1);
  }

  for (let round = 0; round < count; round++) {
    console.log(`Benchmark round ${round + 1}/${count}`);
    for (const suite of suites) {
      const flags = args.smoke ? ["--smoke"] : [];
      if (suite === "http" || suite === "postgres")
        flags.push("--requests", String(requests));
      // Reads only a disposable job database; URLs never go into command output.
      if (suite === "postgres" && process.env.BENCH_DATABASE_URL)
        flags.push("--pg");
      await measure(suite, flags);
    }
  }
  // The paired compiler harness already computes its own round medians.
  await measure("compiler", [
    "--oha",
    argStr(args, "oha", process.env.BENCH_OHA ?? "oha"),
    "--rounds",
    String(count),
    "--requests",
    String(compilerRequests),
  ]);

  const git = (format: string) =>
    execFileSync("git", ["log", "-1", `--format=${format}`], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  const snapshot: Snapshot = {
    sha: manifest.brick_commit,
    date: new Date(git("%cI")).toISOString(),
    message: git("%s"),
    os: platform(),
    arch: arch(),
    cpu: manifest.cpu,
    runtime: manifest.runtime,
    dirty: manifest.working_tree_dirty,
    measuredAt: new Date().toISOString(),
    count,
    results: medians(samples),
    skipped: [...skipped],
    failures,
    suiteCounts,
  };
  await mkdir(dirname(resolve(out)), { recursive: true });
  await Bun.write(out, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`Measured ${[...measuredSuites].join(", ")}; wrote ${out}`);
  if (failures.length) {
    console.error(`Benchmark failures:\n${failures.join("\n")}`);
    process.exitCode = 1;
  }
}

/** Import one measured local artifact, retaining its original revision and dirty flag. */
async function importLocal(out: string, path: string) {
  const data = await Bun.file(path).json();
  const manifest = data.manifest;
  const suite = path.split(/[\\/]/).at(-1)!.split("-")[0]!;
  const snapshot: Snapshot = {
    sha: manifest.brick_commit,
    date: manifest.timestamp,
    message: `Local ${suite} benchmark`,
    os: manifest.os.split("-")[0],
    arch: manifest.os.split("-")[1]?.split(" ")[0] ?? "unknown",
    cpu: manifest.cpu,
    runtime: manifest.runtime,
    dirty: manifest.working_tree_dirty,
    measuredAt: manifest.timestamp,
    count: data.rounds ?? 1,
    results: normalize(suite, data),
    skipped: [],
    failures: [],
  };
  const { sha, date, message, os, ...run } = snapshot;
  await Bun.write(
    out,
    JSON.stringify(
      latest([{ sha, date, message, runs: { [os]: run } }]),
      null,
      2,
    ) + "\n",
  );
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "run") await run(args);
    else if (command === "merge" && args.length >= 2)
      await merge(args[0]!, args.slice(1));
    else if (command === "import" && args.length === 2)
      await importLocal(args[0]!, args[1]!);
    else
      throw new Error(
        "Usage: bun bench/ci.ts run --out file [--rounds 3] [--requests 500] [--compiler-requests 10000] [--oha path] [--smoke]\n       bun bench/ci.ts merge <data directory> <snapshots...>",
      );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
