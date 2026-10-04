/** Environment manifest + comparison/gate helpers */
import { cpus, arch, platform, release, totalmem } from "node:os";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export interface BenchManifest {
  brick_commit: string;
  working_tree_dirty: boolean;
  lockfile_sha256: string;
  runtime: string;
  os: string;
  cpu: string;
  cpu_count: number;
  mem_gb: number;
  db: string;
  benchmark: string;
  dataset_rows: number;
  concurrency: number;
  offered_rps: number;
  timestamp: string;
  lane: "secondary" | "linux-x64-report-only";
}

export function gitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export function collectManifest(opts: {
  benchmark: string;
  db?: string;
  dataset_rows?: number;
  concurrency?: number;
  offered_rps?: number;
}): BenchManifest {
  const cpuList = cpus();
  const isLinuxX64 = platform() === "linux" && arch() === "x64";
  return {
    brick_commit: gitCommit(),
    working_tree_dirty: execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0,
    lockfile_sha256: createHash("sha256").update(readFileSync(new URL("../../bun.lock", import.meta.url))).digest("hex"),
    runtime: `bun-${Bun.version}`,
    os: `${platform()}-${arch()} (${release()})`,
    cpu: cpuList[0]?.model?.trim() ?? "unknown",
    cpu_count: cpuList.length,
    mem_gb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    db: opts.db ?? "sqlite-memory",
    benchmark: opts.benchmark,
    dataset_rows: opts.dataset_rows ?? 0,
    concurrency: opts.concurrency ?? 0,
    offered_rps: opts.offered_rps ?? 0,
    timestamp: new Date().toISOString(),
    lane: isLinuxX64 ? "linux-x64-report-only" : "secondary",
  };
}

export interface ComparisonArtifact {
  benchmark: string;
  baseline: string;
  candidate: string;
  rps: { baseline: number; candidate: number; delta_pct: number };
  p99_us: { baseline: number; candidate: number; delta_pct: number };
  rss_mb: { baseline: number; candidate: number; delta_pct: number };
}

export function deltaPct(baseline: number, candidate: number): number {
  if (baseline === 0) return 0;
  return Math.round(((candidate - baseline) / baseline) * 10000) / 100;
}

export interface GateResult {
  gate: string;
  baseline: number;
  candidate: number;
  delta_pct: number;
  threshold: string;
  pass: boolean;
}

/**
 * Dedicated-hardware gates from the benchmarking doc (calibrate after weeks
 * of variance). Never applied to shared-runner / macOS-second-lane runs —
 * there they are report-only.
 */
export function checkGates(input: {
  rpsBase: number;
  rpsCand: number;
  p99Base: number;
  p99Cand: number;
  cpuPerReqBase: number;
  cpuPerReqCand: number;
  rssBase: number;
  rssCand: number;
  startupBase?: number;
  startupCand?: number;
  stmtsBase?: number;
  stmtsCand?: number;
  enforce: boolean;
}): { gates: GateResult[]; pass: boolean } {
  const g = (gate: string, baseline: number, candidate: number, threshold: string, pass: boolean): GateResult => ({
    gate,
    baseline: Math.round(baseline * 100) / 100,
    candidate: Math.round(candidate * 100) / 100,
    delta_pct: deltaPct(baseline, candidate),
    threshold,
    pass,
  });
  const gates = [
    g("throughput", input.rpsBase, input.rpsCand, ">= -5%", input.rpsCand >= input.rpsBase * 0.95),
    g("p99", input.p99Base, input.p99Cand, "<= +8%", input.p99Cand <= input.p99Base * 1.08),
    g("cpu_per_req", input.cpuPerReqBase, input.cpuPerReqCand, "<= +8%", input.cpuPerReqCand <= input.cpuPerReqBase * 1.08),
    g("rss", input.rssBase, input.rssCand, "<= +10%", input.rssCand <= input.rssBase * 1.1),
  ];
  if (input.startupBase !== undefined && input.startupCand !== undefined) {
    gates.push(
      g("startup", input.startupBase, input.startupCand, "<= +10%", input.startupCand <= input.startupBase * 1.1)
    );
  }
  if (input.stmtsBase !== undefined && input.stmtsCand !== undefined) {
    gates.push(
      g(
        "statements_per_request",
        input.stmtsBase,
        input.stmtsCand,
        "no increase unless approved",
        input.stmtsCand <= input.stmtsBase
      )
    );
  }
  return { gates, pass: gates.every((x) => x.pass) };
}

export function resultsDir(): string {
  return new URL("../../bench/results/", import.meta.url).pathname;
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export async function writeJson(name: string, data: unknown): Promise<string> {
  const dir = resultsDir();
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  const path = `${dir}${name}`;
  await Bun.write(path, JSON.stringify(data, null, 2));
  return path;
}
