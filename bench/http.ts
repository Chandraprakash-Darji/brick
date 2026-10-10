#!/usr/bin/env bun
/**
 * HTTP scenario matrix
 *
 * Concurrency levels 1, 16, 64, 256 (+1024 opt-in via --c1k; stop if the
 * generator itself saturates). Every scenario records latency
 * p50/p90/p95/p99/p99.9/max, offered vs completed goodput, errors, CPU/req,
 * RSS, event-loop delay, bytes/req (doc "Metrics (every server run)").
 *
 * Usage:
 *   bun bench/http.ts [--smoke] [--filter <regex>] [--requests N]
 *     [--concurrency 1,16,64,256] [--rows 5000] [--rows100k] [--large]
 *     [--pg <url>] [--no-file] [--c1k]
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "../packages/core/src/index";
import { benchTable } from "./lib/fixtures";
import { seedRows, explainPlan } from "./lib/fixtures";
import { runLoad, externalTools, type LoadResult } from "./lib/load";
import { parseArgs, argInt, argStr, argList } from "./lib/stats";
import { collectManifest, writeJson, stamp } from "./lib/manifest";
import {
  startFloorServer,
  startElysiaServer,
  startBrickServer,
  BENCH_PORTS,
} from "./http-server";

interface Scenario {
  benchmark: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | (() => string);
}

const JSON_H = { "Content-Type": "application/json" };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const smoke = args["smoke"] === true;
  const filter = args["filter"]
    ? new RegExp(argStr(args, "filter", ".*"))
    : /.*/;
  const requests = argInt(args, "requests", smoke ? 200 : 2000);
  let concurrencies = argList(
    args,
    "concurrency",
    smoke ? [1, 16] : [1, 16, 64, 256],
  );
  if (args["c1k"] === true && !concurrencies.includes(1024))
    concurrencies.push(1024);
  const baseRows = argInt(args, "rows", smoke ? 500 : 5000);
  const want100k = args["rows100k"] !== false && !smoke; // scaling leg, skip in smoke
  const large = args["large"] === true; // 10M leg + 10/100MiB streams (minutes)
  const pgUrl =
    args["pg"] === true
      ? (process.env["DATABASE_URL"] ?? "")
      : argStr(args, "pg", "");
  const noFile = args["no-file"] === true;
  const tools = await externalTools();

  console.log(
    `starting servers (floor :${BENCH_PORTS.floor}, elysia :${BENCH_PORTS.elysia}, brick :${BENCH_PORTS.brick})…`,
  );
  const floor = startFloorServer(BENCH_PORTS.floor);
  const elysia = await startElysiaServer(BENCH_PORTS.elysia);
  const brick = await startBrickServer({
    port: BENCH_PORTS.brick,
    rows: baseRows,
  });

  let fileBench: any = null;
  try {
    if (!noFile && !smoke) {
      const tmp = join(tmpdir(), `brick-bench-${Date.now()}.sqlite`);
      fileBench = await startBrickServer({
        port: BENCH_PORTS.brickFile,
        rows: 2000,
        dbPath: tmp,
      });
      console.log(
        `file-backed sqlite (WAL) on :${BENCH_PORTS.brickFile} rows=2000`,
      );
    }

    const B = `http://127.0.0.1:${BENCH_PORTS.brick}`;
    const F = `http://127.0.0.1:${BENCH_PORTS.floor}`;
    const E = `http://127.0.0.1:${BENCH_PORTS.elysia}`;
    const VALID = JSON.stringify({
      slug: "bench-slug",
      title: "Benchmark title",
      count: 3,
    });

    // Seeded id for get/update scenarios.
    const sampleId = "seed_0";

    const scenarios: Scenario[] = [
      {
        benchmark: "floor.bun-serve",
        method: "POST",
        url: `${F}/`,
        headers: JSON_H,
        body: VALID,
      },
      {
        benchmark: "tax.elysia",
        method: "POST",
        url: `${E}/__bench/noop`,
        headers: JSON_H,
        body: VALID,
      },
      {
        benchmark: "tax.raw-endpoint",
        method: "POST",
        url: `${B}/__bench/noop`,
        headers: JSON_H,
        body: VALID,
      },
      {
        benchmark: "tax.no-schema",
        method: "POST",
        url: `${B}/api/bench/noop`,
        headers: JSON_H,
        body: VALID,
      },
      {
        benchmark: "tax.validated",
        method: "POST",
        url: `${B}/api/bench/validated`,
        headers: JSON_H,
        body: VALID,
      },
      {
        benchmark: "tax.full-auth-ctx",
        method: "POST",
        url: `${B}/api/bench/full`,
        headers: { ...JSON_H, "x-user-id": "bench-user" },
        body: VALID,
      },
      {
        benchmark: "resource.get",
        method: "GET",
        url: `${B}/api/item/${sampleId}`,
      },
      {
        benchmark: "resource.create",
        method: "POST",
        url: `${B}/api/item`,
        headers: JSON_H,
        body: () =>
          JSON.stringify({
            slug: `c-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
            title: "Created by bench",
            content: "body",
          }),
      },
      {
        benchmark: "resource.list",
        method: "POST",
        url: `${B}/api/item/query`,
        headers: JSON_H,
        body: JSON.stringify({ limit: 20 }),
      },
      {
        benchmark: "resource.update",
        method: "PATCH",
        url: `${B}/api/item/${sampleId}`,
        headers: JSON_H,
        body: JSON.stringify({ data: { title: "Updated by bench" } }),
      },
      {
        benchmark: "payload.post-1kib",
        method: "POST",
        url: `${B}/__bench/echo/1kib`,
        headers: JSON_H,
        body: JSON.stringify({ data: "x".repeat(900) }),
      },
      {
        benchmark: "payload.post-32kib",
        method: "POST",
        url: `${B}/__bench/echo/32kib`,
        headers: JSON_H,
        body: JSON.stringify({ data: "x".repeat(32 * 1024 - 64) }),
      },
      {
        benchmark: "payload.get-256kib",
        method: "GET",
        url: `${B}/__bench/json/256kib`,
      },
      {
        benchmark: "stream.raw-1mib",
        method: "GET",
        url: `${B}/__bench/stream/1mib`,
      },
      {
        benchmark: "rtt.synthetic-1-trip",
        method: "POST",
        url: `${B}/api/bench/roundtrips`,
        headers: JSON_H,
        body: JSON.stringify({ trips: 1 }),
      },
      {
        benchmark: "rtt.synthetic-3-trips",
        method: "POST",
        url: `${B}/api/bench/roundtrips`,
        headers: JSON_H,
        body: JSON.stringify({ trips: 3 }),
      },
      {
        benchmark: "tail.slow-query",
        method: "POST",
        url: `${B}/api/bench/slow`,
        headers: JSON_H,
        body: "{}",
      },
      {
        benchmark: "search.indexed",
        method: "GET",
        url: `${B}/api/item?limit=20&search=Benchmark`,
      },
      {
        benchmark: "search.filter-unindexed",
        method: "GET",
        url: `${B}/api/item?limit=20&status=published`,
      },
      {
        benchmark: "cursor.shallow",
        method: "GET",
        url: `${B}/api/item?limit=20`,
      },
    ];
    if (large)
      for (const mib of [10, 100])
        scenarios.push({
          benchmark: `stream.raw-${mib}mib`,
          method: "GET",
          url: `${B}/__bench/stream/${mib}mib`,
        });

    const results: LoadResult[] = [];
    const skipped: { benchmark: string; reason: string }[] = [];

    const keep = (name: string) => filter.test(name);

    // The bench server's per-request action logging (e.g. resource create logs
    // every row via ctx.logger) would flood bench output and add TTY I/O noise
    // to timings. Suppress app-level stdout during load phases only — error
    // output stays visible. Production services inject their own sampled logger.
    const _log = console.log.bind(console);
    const _info = console.info.bind(console);
    const _debug = (console.debug as any).bind?.(console) ?? (() => {});
    const quiet = () => {
      console.log = () => {};
      console.info = () => {};
      (console as any).debug = () => {};
    };
    const loud = () => {
      console.log = _log;
      console.info = _info;
      (console as any).debug = _debug;
    };
    const load = async (opts: Parameters<typeof runLoad>[0]) => {
      quiet();
      try {
        return await runLoad(opts);
      } finally {
        loud();
      }
    };

    for (const c of concurrencies) {
      for (const s of scenarios) {
        if (!keep(`${s.benchmark}/c${c}`)) continue;
        // Slow-query under background load: fire-and-forget noop traffic while measuring.
        let bg: ReturnType<typeof setInterval> | null = null;
        if (s.benchmark === "tail.slow-query" && c >= 16) {
          bg = setInterval(() => {
            fetch(`${B}/__bench/noop`, {
              method: "POST",
              headers: JSON_H,
              body: VALID,
            }).then(
              (r) => r.arrayBuffer().catch(() => {}),
              () => {},
            );
          }, 5);
        }
        process.stdout.write(`  [c=${c}] ${s.benchmark} … `);
        const r = await load({
          name: `${s.benchmark} c=${c}`,
          url: s.url,
          method: s.method,
          headers: s.headers,
          body: s.body,
          concurrency: c,
          requests:
            s.benchmark.startsWith("stream.") ||
            s.benchmark.startsWith("payload.get")
              ? Math.min(requests, 200)
              : requests,
        });
        if (bg) clearInterval(bg);
        results.push(r);
        console.log(
          `${r.rps.toLocaleString()} rps  p50=${r.latency.p50_ms}ms p99=${r.latency.p99_ms}ms p99.9=${r.latency.p999_ms}ms err=${r.errors}`,
        );
        if (c === 1024 && r.event_loop_delay_ms > 5) {
          console.log(
            `    generator saturated (event-loop delay ${r.event_loop_delay_ms}ms) — stopping 1024 sweep here.`,
          );
          break;
        }
      }
    }

    // Delete leg (after the main matrix so pool rows never perturb list/search
    // totals): per concurrency level, seed a fresh pool and delete each id once.
    if (keep("resource.delete")) {
      for (const c of concurrencies) {
        if (!keep(`resource.delete/c${c}`)) continue;
        const n = Math.min(requests, 2000);
        console.log(`  seeding delete pool (${n} rows)…`);
        await seedRows(brick.db, n, {
          prefix: `delpool${c}_${Date.now() % 100000}`,
        });
        // Resolve the seeded ids in insertion order for deterministic consumption.
        const ids = (brick.db as any).$client
          .query(
            `SELECT "id" FROM "bench_items" WHERE "id" LIKE 'delpool${c}_%' ORDER BY rowid`,
          )
          .all()
          .map((r: any) => r.id as string);
        let idx = 0;
        const nextUrl = () => `${B}/api/item/${ids[idx++ % ids.length]}`;
        process.stdout.write(`  [c=${c}] resource.delete … `);
        const r = await load({
          name: `resource.delete c=${c}`,
          url: nextUrl,
          method: "DELETE",
          concurrency: c,
          requests: n,
        });
        results.push(r);
        console.log(
          `${r.rps.toLocaleString()} rps  p50=${r.latency.p50_ms}ms p99=${r.latency.p99_ms}ms p99.9=${r.latency.p999_ms}ms err=${r.errors} ${JSON.stringify(r.statusCodes)}`,
        );
      }
    }
    if (keep("cursor.deep")) {
      let cursor = "";
      for (let i = 0; i < 40; i++) {
        const res = await fetch(
          `${B}/api/item?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        const json: any = await res.json();
        if (!json.nextCursor) break;
        cursor = json.nextCursor;
      }
      if (cursor) {
        for (const c of concurrencies) {
          if (!keep(`cursor.deep/c${c}`)) continue;
          const r = await load({
            name: `cursor.deep c=${c}`,
            url: `${B}/api/item?limit=20&cursor=${encodeURIComponent(cursor)}`,
            concurrency: c,
            requests: Math.min(requests, 500),
          });
          (r as any).name = "cursor.deep";
          results.push(r);
          console.log(
            `  [c=${c}] cursor.deep … ${r.rps.toLocaleString()} rps p99=${r.latency.p99_ms}ms`,
          );
        }
      } else {
        skipped.push({
          benchmark: "cursor.deep",
          reason: "no nextCursor (dataset smaller than 800 rows?)",
        });
      }
    }

    // Scaling leg: grow the same DB to 100K (and 10M with --large) then list-20.
    if (want100k || large) {
      const targets = large ? [100_000, 10_000_000] : [100_000];
      for (const target of targets) {
        if (!keep(`scale.list-20-from-${target}`)) continue;
        console.log(
          `  seeding to ${target.toLocaleString()} rows (chunked bulk insert)…`,
        );
        const t0 = performance.now();
        const existing =
          (
            await brick.db
              .select({ n: sql<number>`count(*)`.mapWith(Number) })
              .from(benchTable)
          )[0]?.n ?? 0;
        if (existing < target) {
          const CH = 2000;
          for (let base = existing; base < target; base += CH) {
            await seedRows(brick.db, Math.min(CH, target - base), {
              prefix: `scale${target}_${base}`,
            });
            if (base % 20000 === 0)
              process.stdout.write(`    …${base.toLocaleString()}\r`);
          }
        }
        console.log(
          `    seeded in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
        );
        for (const c of [1, 16]) {
          const r = await load({
            name: `scale.list-20-from-${target} c=${c}`,
            url: `${B}/api/item?limit=20`,
            concurrency: c,
            requests: Math.min(requests, 500),
          });
          (r as any).name = `scale.list-20-from-${target}`;
          results.push(r);
          console.log(
            `  [c=${c}] scale.list-20-from-${target} … ${r.rps.toLocaleString()} rps p99=${r.latency.p99_ms}ms`,
          );
        }
      }
    }

    // COUNT(*) vs no-total leg (in-process SQL timing + plan artifacts).
    let countLeg: any = null;
    if (keep("count.exact-vs-none")) {
      const db = brick.db;
      const timeN = async (fn: () => Promise<unknown>, n: number) => {
        for (let i = 0; i < 5; i++) await fn();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) await fn();
        return ((performance.now() - t0) * 1000) / n; // µs
      };
      const where = eq(benchTable.status, "published");
      const withTotal = await timeN(
        () =>
          db
            .select({ n: sql<number>`count(*)`.mapWith(Number) })
            .from(benchTable)
            .where(where),
        50,
      );
      const noTotal = await timeN(
        () => db.select().from(benchTable).where(where).limit(20).offset(0),
        50,
      );
      countLeg = {
        count_us: Math.round(withTotal),
        page_no_count_us: Math.round(noTotal),
      };
      console.log(
        `  count: COUNT(*)=${Math.round(withTotal)}µs vs page-without-count=${Math.round(noTotal)}µs`,
      );
    }

    // File-backed SQLite/WAL leg.
    if (fileBench && keep("file.resource.list")) {
      const FB = `http://127.0.0.1:${BENCH_PORTS.brickFile}`;
      for (const c of [1, 16]) {
        const r = await load({
          name: `file.resource.list c=${c}`,
          url: `${FB}/api/item/query`,
          method: "POST",
          headers: JSON_H,
          body: JSON.stringify({ limit: 20 }),
          concurrency: c,
          requests: Math.min(requests, 500),
        });
        (r as any).name = "file.resource.list";
        results.push(r);
        console.log(
          `  [c=${c}] file.resource.list … ${r.rps.toLocaleString()} rps p99=${r.latency.p99_ms}ms`,
        );
      }
    }

    // PostgreSQL leg (opt-in; skipped with reason otherwise).
    if (pgUrl) {
      skipped.push({
        benchmark: "pg.crud",
        reason: "Run bench/postgres.ts --pg URL (included by run-all)",
      });
    } else {
      skipped.push({
        benchmark: "pg.crud",
        reason:
          "no --pg url; set --pg $DATABASE_URL for the network-DB baseline",
      });
      skipped.push({
        benchmark: "pg.rtt",
        reason: "no --pg url; see rtt.synthetic-N-trips instead",
      });
    }

    // EXPLAIN artifacts (SQLite: scans vs index vs temp sort).
    const plans: Record<string, string[]> = {};
    try {
      const db = brick.db;
      plans["list-20"] = explainPlan(
        db,
        db.select().from(benchTable).limit(20).offset(0),
      );
      plans["filter-status"] = explainPlan(
        db,
        db
          .select()
          .from(benchTable)
          .where(eq(benchTable.status, "published"))
          .limit(20),
      );
      plans["count"] = explainPlan(
        db,
        db
          .select({ n: sql<number>`count(*)`.mapWith(Number) })
          .from(benchTable),
      );
    } catch (err: any) {
      plans["error"] = [String(err?.message ?? err)];
    }

    const manifest = collectManifest({
      benchmark: "http-matrix",
      db: pgUrl ? "postgres" : "sqlite-memory",
      dataset_rows: baseRows,
    });
    const path = await writeJson(`http-${stamp()}.json`, {
      manifest,
      requests,
      concurrencies,
      results,
      skipped,
      countLeg,
      plans,
      externalTools: tools,
    });

    console.log(
      `\nwrote ${path} (${results.length} runs, ${skipped.length} skipped)`,
    );
    if (!tools.oha && !tools.wrk) {
      console.log(
        "note: neither oha nor wrk found — numbers above are from the built-in loader.",
      );
      console.log(
        "Use oha -q RATE for offered-rate tests against a standalone server; local results are closed-loop.",
      );
    }
  } finally {
    floor.stop(true);
    await elysia.stop();
    await brick.stop();
    if (fileBench) await fileBench.stop();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
