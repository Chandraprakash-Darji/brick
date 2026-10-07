#!/usr/bin/env bun
/**
 * Full benchmark lab runner
 *
 * Runs every suite (micro → prepared → batch → startup → http matrix),
 * writes per-suite JSON artifacts + an aggregated report + manifest, and
 * optionally compares against a baseline with dedicated-hardware gates.
 *
 * Usage:
 *   bun bench/run-all.ts [--smoke] [--filter <regex>] [--requests N]
 *     [--concurrency 1,16,64,256] [--rows 5000] [--large] [--pg <url>]
 *     [--suites micro,prepared,batch,startup,http]
 *     [--baseline bench/results/run-all-<stamp>.json] [--enforce-gates]
 *
 * Discipline: Linux x86_64 is the hard gate (dedicated, pinned); macOS is a
 * second lane — gates are report-only unless --enforce-gates is passed.
 */
import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { parseArgs, argStr } from "./lib/stats";
import { collectManifest, checkGates, deltaPct, writeJson, stamp, resultsDir } from "./lib/manifest";

const SUITES = ["micro", "prepared", "batch", "startup", "footprint", "http", "postgres"] as const;

async function runSuite(suite: string, passthrough: string[]): Promise<void> {
  console.log(`\n############ suite: ${suite} ############`);
  const proc = Bun.spawn([process.execPath, `bench/${suite}.ts`, ...passthrough], {
    cwd: resolve(import.meta.dir, ".."),
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`suite ${suite} exited with code ${code}`);
}

async function newest(prefix: string, sinceMs: number): Promise<string | null> {
  const dir = resultsDir();
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }
  let best: { f: string; t: number } | null = null;
  for (const f of files) {
    if (!f.startsWith(prefix) || !f.endsWith(".json")) continue;
    const st = await Bun.file(`${dir}${f}`).stat().catch(() => null);
    const t = (st as any)?.mtime?.getTime?.() ?? 0;
    if (t >= sinceMs - 5000 && (!best || t > best.t)) best = { f, t };
  }
  return best ? `${dir}${best.f}` : null;
}

async function loadJson(path: string | null): Promise<any> {
  if (!path) return null;
  try {
    return await Bun.file(path).json();
  } catch {
    return null;
  }
}

function httpAtC(data: any, name: string, c: number): any {
  // runLoad names are `${benchmark} c=${c}` (legs override to plain names).
  return (
    data?.results?.find?.(
      (r: any) => (r.name === name || r.name === `${name} c=${c}`) && r.concurrency === c
    ) ?? null
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const smoke = args["smoke"] === true;
  const suites = argStr(args, "suites", SUITES.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const baselinePath = args["baseline"] ? argStr(args, "baseline", "") : "";
  const enforceGates = args["enforce-gates"] === true;
  if (enforceGates) throw new Error("Gates are report-only: this local harness combines server and generator CPU/RSS. Use isolated, dedicated measurements before enforcing performance gates.");

  const passthrough: string[] = [];
  if (smoke) passthrough.push("--smoke");
  for (const k of ["filter", "requests", "concurrency", "rows", "runs", "large", "pg", "no-file", "c1k", "rows100k", "iters"]) {
    const v = (args as any)[k];
    if (v === undefined || v === false) continue;
    if (v === true) passthrough.push(`--${k}`);
    else passthrough.push(`--${k}`, String(v));
  }
  const startMs = Date.now();

  for (const s of suites) {
    if (!(SUITES as readonly string[]).includes(s)) throw new Error(`unknown suite: ${s}`);
    await runSuite(s, passthrough);
  }

  // Collect newest artifacts per suite.
  const paths: Record<string, string | null> = {};
  for (const s of suites) paths[s] = await newest(s === "http" ? "http-" : `${s}-`, startMs);
  const docs: Record<string, any> = {};
  for (const s of suites) docs[s] = await loadJson(paths[s]);

  // ---- summary: progressive framework tax at c=16 (or c=1 in smoke) ----
  const C = smoke ? 1 : 16;
  const layers = ["floor.bun-serve", "tax.elysia", "tax.raw-endpoint", "tax.no-schema", "tax.validated", "tax.full-auth-ctx"];
  interface TaxRow {
    layer: string;
    rps: number | null;
    p50_ms: number | null;
    p99_ms: number | null;
    cpu_ms_per_req: number | null;
    tax_vs_floor_pct?: number | null;
  }
  const taxTable: TaxRow[] = layers.map((name) => {
    const r = httpAtC(docs["http"], name, C);
    return {
      layer: name,
      rps: r?.goodput_rps ?? null,
      p50_ms: r?.latency?.p50_ms ?? null,
      p99_ms: r?.latency?.p99_ms ?? null,
      cpu_ms_per_req: r?.cpu_ms_per_req ?? null,
    };
  });
  const floorRps = taxTable[0]?.rps || 0;
  for (const row of taxTable) {
    row.tax_vs_floor_pct = row.rps && floorRps ? Math.round(((floorRps - row.rps) / floorRps) * 10000) / 100 : null;
  }

  const noopC = httpAtC(docs["http"], "tax.no-schema", C);
  const listC = httpAtC(docs["http"], "resource.list", C);
  const summary: Record<string, number | string | null> = {
    concurrency: C,
    floor_rps: taxTable[0]?.rps ?? null,
    elysia_rps: taxTable[1]?.rps ?? null,
    brick_raw_rps: taxTable[2]?.rps ?? null,
    brick_noop_rps: taxTable[3]?.rps ?? null,
    brick_validated_rps: taxTable[4]?.rps ?? null,
    brick_full_rps: taxTable[5]?.rps ?? null,
    brick_noop_p99_ms: taxTable[3]?.p99_ms ?? null,
    brick_noop_cpu_ms: noopC?.cpu_ms_per_req ?? null,
    brick_noop_rss_mb: noopC?.rss_mb_peak ?? null,
    resource_list_rps: listC?.goodput_rps ?? null,
    resource_list_p99_ms: listC?.latency?.p99_ms ?? null,
    resource_get_rps: httpAtC(docs["http"], "resource.get", C)?.goodput_rps ?? null,
  };

  // ---- baseline comparison + gates ----
  let comparison: any = null;
  let gates: any = null;
  if (baselinePath) {
    const base = await loadJson(baselinePath);
    if (!base?.summary) throw new Error(`Invalid or unreadable baseline: ${baselinePath}`);
    const b = base?.summary ?? {};
    if (b.concurrency !== C) throw new Error("Baseline concurrency does not match candidate");
    for (const key of ["brick_noop_rps", "brick_noop_p99_ms"]) {
      if (typeof b[key] !== "number" || typeof summary[key] !== "number") throw new Error(`Missing comparison metric: ${key}`);
    }
    const num = (v: unknown) => (typeof v === "number" ? v : 0);
    comparison = {
      benchmark: "http.no-schema",
      baseline: base?.manifest?.brick_commit ?? "unknown",
      candidate: collectManifest({ benchmark: "run-all" }).brick_commit,
      rps: {
        baseline: num(b.brick_noop_rps), candidate: num(summary.brick_noop_rps),
        delta_pct: deltaPct(num(b.brick_noop_rps), num(summary.brick_noop_rps)),
      },
      p99_us: {
        baseline: num(b.brick_noop_p99_ms) * 1000, candidate: num(summary.brick_noop_p99_ms) * 1000,
        delta_pct: deltaPct(num(b.brick_noop_p99_ms), num(summary.brick_noop_p99_ms)),
      },
      rss_mb: {
        baseline: num(b.brick_noop_rss_mb), candidate: num(summary.brick_noop_rss_mb),
        delta_pct: deltaPct(num(b.brick_noop_rss_mb), num(summary.brick_noop_rss_mb)),
      },
    };
    const gateInput = {
      rpsBase: num(b.brick_noop_rps), rpsCand: num(summary.brick_noop_rps),
      p99Base: num(b.brick_noop_p99_ms), p99Cand: num(summary.brick_noop_p99_ms),
      cpuPerReqBase: num(b.brick_noop_cpu_ms), cpuPerReqCand: num(summary.brick_noop_cpu_ms),
      rssBase: num(b.brick_noop_rss_mb), rssCand: num(summary.brick_noop_rss_mb),
      enforce: enforceGates,
    };
    gates = checkGates(gateInput);
    // Baselines written before cpu/rss were recorded carry 0 — mark those
    // gates as no-data instead of comparing against zero.
    for (const g of gates.gates) {
      if ((g.gate === "cpu_per_req" || g.gate === "rss") && g.baseline === 0) {
        g.threshold += " (no baseline data)";
        g.pass = true;
      }
    }
    gates.pass = gates.gates.every((g: { pass: boolean }) => g.pass);
    if (!enforceGates) {
      console.log("\nnote: gates are report-only (macOS second lane / shared runner). Pass --enforce-gates on dedicated Linux x86_64.");
    }
  }

  const manifest = collectManifest({ benchmark: "run-all", db: "sqlite-memory" });
  const aggPath = await writeJson(`run-all-${stamp()}.json`, {
    manifest, suites: paths, summary, taxTable, comparison, gates,
  });

  // ---- markdown report ----
  const L: string[] = [];
  L.push(`# Brick benchmark report`);
  L.push(``);
  L.push(`- commit: \`${manifest.brick_commit}\` · runtime: \`${manifest.runtime}\` · os: \`${manifest.os}\``);
  L.push(`- cpu: \`${manifest.cpu} × ${manifest.cpu_count}\` · lane: \`${manifest.lane}\``);
  L.push(`- date: ${manifest.timestamp} · suites: ${suites.join(", ")}${smoke ? " (smoke)" : ""}`);
  L.push(``);
  L.push(`> Max RPS alone is not a result. Report goodput at acceptable p99/p99.9 within CPU + memory budget.`);
  L.push(`> Local closed-loop measurements; CPU/RSS include both the server and generator. Not a dedicated-hardware gate or a constant-rate tail test.`);
  L.push(``);
  L.push(`## Progressive framework tax (c=${C})`);
  L.push(``);
  L.push(`| layer | goodput/s | p50 ms | p99 ms | combined cpu ms/req | tax vs floor |`);
  L.push(`| --- | --- | --- | --- | --- | --- |`);
  for (const r of taxTable) {
    L.push(`| ${r.layer} | ${r.rps ?? "–"} | ${r.p50_ms ?? "–"} | ${r.p99_ms ?? "–"} | ${r.cpu_ms_per_req ?? "–"} | ${r.tax_vs_floor_pct ?? "–"}% |`);
  }
  L.push(``);
  if (gates) {
    L.push(`## Gates vs baseline ${comparison.baseline}`);
    L.push(``);
    L.push(`| gate | baseline | candidate | Δ% | threshold | ${enforceGates ? "result" : "advisory"} |`);
    L.push(`| --- | --- | --- | --- | --- | --- |`);
    for (const g of gates.gates) {
      L.push(`| ${g.gate} | ${g.baseline} | ${g.candidate} | ${g.delta_pct}% | ${g.threshold} | ${g.pass ? "PASS" : "FAIL"} |`);
    }
    L.push(``);
  }
  L.push(`## Artifacts`);
  L.push(``);
  for (const s of suites) L.push(`- ${s}: \`${paths[s] ?? "missing"}\``);
  L.push(`- aggregate: \`${aggPath}\``);
  L.push(``);
  const reportName = `REPORT-${stamp()}.md`;
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(resultsDir(), { recursive: true });
  await writeFile(`${resultsDir()}${reportName}`, L.join("\n"));
  console.log(`\n${L.join("\n")}`);
  console.log(`\nwrote ${aggPath}`);
  console.log(`wrote ${resultsDir()}${reportName}`);

  if (gates && enforceGates && !gates.pass) {
    console.error("\nGATES FAILED");
    process.exit(2);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
