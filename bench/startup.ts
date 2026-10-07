#!/usr/bin/env bun
/**
 * Server-init + cold-start suite
 * ("Server init" micro row + "start→listening and first-request latency").
 *
 * Usage:
 *   bun bench/startup.ts [--smoke] [--runs 10]
 *   hyperfine --warmup 5 --runs 30 'bun bench/startup-once.ts'
 */
import {
  defineService,
  defineAction,
  resetGlobalRegistry,
} from "../packages/core/src/index";
import { brick } from "../packages/cli/src/server";
import { parseArgs, argInt, median, percentile } from "./lib/stats";
import { collectManifest, writeJson, stamp } from "./lib/manifest";

export interface StartupSample {
  actions: number;
  build_ms: number;
  listen_ms: number;
  first_request_ms: number;
  rss_mb: number;
}

export async function measureStartup(
  actions: number,
  port: number,
): Promise<StartupSample> {
  resetGlobalRegistry();
  const svc = defineService(`startup_${actions}_${port}`);
  for (let i = 0; i < actions; i++) {
    svc.action(
      defineAction({ name: `a${i}`, execute: async () => ({ ok: true }) }),
    );
  }
  const t0 = performance.now();
  const app = brick({ services: [svc], requestLogging: false, docs: false });
  const buildMs = performance.now() - t0;

  const t1 = performance.now();
  app.listen(port);
  const listenMs = performance.now() - t1;

  const t2 = performance.now();
  const res = await fetch(`http://127.0.0.1:${port}/_health`);
  await res.arrayBuffer();
  const firstMs = performance.now() - t2;

  const rssMb = Math.round((process.memoryUsage().rss / 1024 ** 2) * 100) / 100;
  await app.stop();
  await new Promise((r) => setTimeout(r, 50));
  return {
    actions,
    build_ms: r3(buildMs),
    listen_ms: r3(listenMs),
    first_request_ms: r3(firstMs),
    rss_mb: rssMb,
  };
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function dist(name: string, vals: number[]): Record<string, number> {
  const s = [...vals].sort((a, b) => a - b);
  return {
    median: r3(median(vals)),
    p95: r3(percentile(s, 95)),
    min: r3(s[0] ?? 0),
    max: r3(s[s.length - 1] ?? 0),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const smoke = args["smoke"] === true;
  const runs = argInt(args, "runs", smoke ? 3 : 10);
  const counts = smoke ? [10, 100] : [10, 100, 1000];

  const samples: StartupSample[] = [];
  for (const n of counts) {
    console.log(`== startup: ${n} actions × ${runs} runs ==`);
    for (let i = 0; i < runs; i++) {
      const s = await measureStartup(n, 3490 + (i % 20));
      samples.push(s);
      console.log(
        `  run ${i + 1}: build=${s.build_ms}ms listen=${s.listen_ms}ms first=${s.first_request_ms}ms rss=${s.rss_mb}MB`,
      );
    }
  }

  const byCount: Record<string, unknown> = {};
  for (const n of counts) {
    const group = samples.filter((s) => s.actions === n);
    byCount[`${n}_actions`] = {
      build_ms: dist(
        "build",
        group.map((g) => g.build_ms),
      ),
      listen_ms: dist(
        "listen",
        group.map((g) => g.listen_ms),
      ),
      first_request_ms: dist(
        "first",
        group.map((g) => g.first_request_ms),
      ),
      rss_mb: dist(
        "rss",
        group.map((g) => g.rss_mb),
      ),
    };
  }

  const manifest = collectManifest({ benchmark: "startup", db: "none" });
  const path = await writeJson(`startup-${stamp()}.json`, {
    manifest,
    runs,
    samples,
    summary: byCount,
  });
  console.log(`\nwrote ${path}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
