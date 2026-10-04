#!/usr/bin/env bun
/**
 * Batch + service-profile suite
 * "Service profiles + batch suite".
 *
 * - 1M validations+transforms (never hold all in memory where streaming fits)
 * - JSONL stream: parse+transform a generated stream record-by-record
 * - Transactional bulk writes: row-by-row vs chunked vs single-txn
 * - CPU-parallelizable transform: single-thread + Bun Worker verification
 * - I/O-heavy transform: simulated async I/O at concurrency
 * - Read-heavy / write-heavy service profiles against the resource layer
 *
 * Usage: bun bench/batch.ts [--smoke] [--filter <regex>]
 */
import { validateWithSchema, Type } from "../packages/core/src/index";
import { makeBenchFixture, seedRows, silentCtx } from "./lib/fixtures";
import { parseArgs, argStr } from "./lib/stats";
import { collectManifest, writeJson, stamp } from "./lib/manifest";

export interface BatchResult {
  benchmark: string;
  records: number;
  seconds: number;
  records_per_sec: number;
  mb_per_sec?: number;
  cpu_us_per_record?: number;
  bytes_per_record?: number;
  extra?: Record<string, unknown>;
}

function memMb() {
  return Math.round((process.memoryUsage().rss / 1024 ** 2) * 100) / 100;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const smoke = args["smoke"] === true;
  const filter = args["filter"] ? new RegExp(argStr(args, "filter", ".*")) : /.*/;
  const results: BatchResult[] = [];
  const keep = (n: string) => filter.test(n);

  const schema = Type.Object({
    slug: Type.String({ minLength: 2 }),
    title: Type.String({ minLength: 3 }),
    count: Type.Number({ minimum: 0 }),
  });

  if (keep("validations-1M")) {
    const N = smoke ? 100_000 : 1_000_000;
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    let ok = 0;
    for (let i = 0; i < N; i++) {
      const r = validateWithSchema(schema, { slug: `s-${i}`, title: `title ${i}`, count: i % 100 });
      if (r.success) ok++;
      // transform inline (no accumulation — never hold all in memory)
      const t = `${(r as any).data?.slug ?? ""}:${(r as any).data?.count ?? 0}`;
      if (t.length === 0) throw new Error("unreachable");
    }
    const s = (performance.now() - t0) / 1000;
    const cpu = process.cpuUsage(cpu0);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    results.push({
      benchmark: "validations-1M", records: N, seconds: round(s),
      records_per_sec: Math.round(N / s), cpu_us_per_record: round((cpuMs * 1000) / N, 3), extra: { ok },
    });
    console.log(`  validations: ${(N / s).toLocaleString()} rec/s  cpu ${(((cpuMs * 1000) / N)).toFixed(3)}µs/rec`);
  }

  if (keep("jsonl-stream")) {
    const N = smoke ? 20_000 : 200_000;
    // Bounded chunks: generation + parsing are measured together. Never
    // allocate the complete dataset in memory.
    let bytes = 0;
    const t0 = performance.now();
    let count = 0;
    let rest = "";
    const chunks = function* () {
      let chunk = "";
      for (let i = 0; i < N; i++) {
        chunk += JSON.stringify({ slug: `s-${i}`, title: `t ${i}`, count: i % 50 }) + "\n";
        if (chunk.length >= 64 * 1024) { yield chunk; chunk = ""; }
      }
      if (chunk) yield chunk;
    };
    for (const chunk of chunks()) {
      bytes += Buffer.byteLength(chunk);
      const piece = rest + chunk;
      const parts = piece.split("\n");
      rest = parts.pop() ?? "";
      for (const line of parts) {
        const rec = JSON.parse(line);
        const v = validateWithSchema(schema, rec);
        if (v.success) count++;
      }
    }
    if (rest) { const v = validateWithSchema(schema, JSON.parse(rest)); if (v.success) count++; }
    const s = (performance.now() - t0) / 1000;
    const mb = bytes / 1024 ** 2;
    results.push({
      benchmark: "jsonl-stream", records: count, seconds: round(s),
      records_per_sec: Math.round(count / s), mb_per_sec: round(mb / s),
      bytes_per_record: Math.round(bytes / count),
    });
    console.log(`  jsonl-stream: ${(count / s).toLocaleString()} rec/s  ${(mb / s).toFixed(1)} MB/s`);
  }

  if (keep("bulk-writes")) {
    const N = smoke ? 2000 : 20000;
    const mk = (tag: string, i: number, now: string) => ({
      id: `${tag}_${i}`, slug: `${tag}-slug-${i}`, title: `Bulk ${i}`,
      content: "bulk body", status: "draft", views: 0, authorId: null, createdAt: now, updatedAt: now,
    });
    const now = new Date().toISOString();
    const { benchTable: tbl } = await import("./lib/fixtures");

    // 1) row-by-row
    const f1 = makeBenchFixture("batch-bulk1");
    let t0 = performance.now();
    for (let i = 0; i < N; i++) await f1.db.insert(tbl).values(mk("row", i, now));
    let s = (performance.now() - t0) / 1000;
    results.push({ benchmark: "bulk.row-by-row", records: N, seconds: round(s), records_per_sec: Math.round(N / s) });
    console.log(`  bulk row-by-row: ${(N / s).toLocaleString()} rec/s`);

    // 2) chunked bulk (1k rows/statement)
    const f2 = makeBenchFixture("batch-bulk4");
    t0 = performance.now();
    for (let base = 0; base < N; base += 1000) {
      const rows = [];
      for (let i = base; i < Math.min(base + 1000, N); i++) rows.push(mk("chunk", i, now));
      await f2.db.insert(tbl).values(rows);
    }
    s = (performance.now() - t0) / 1000;
    results.push({ benchmark: "bulk.chunked-1k", records: N, seconds: round(s), records_per_sec: Math.round(N / s) });
    console.log(`  bulk chunked-1k: ${(N / s).toLocaleString()} rec/s`);
    const f3 = makeBenchFixture("batch-transaction");
    t0 = performance.now();
    f3.db.$client.transaction(() => {
      const insert = f3.db.$client.prepare(`INSERT INTO bench_items (id, slug, title, content, status, views, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (let i = 0; i < N; i++) insert.run(`txn_${i}`, `txn-slug-${i}`, `Bulk ${i}`, "bulk body", "draft", 0, now, now);
    })();
    s = (performance.now() - t0) / 1000;
    results.push({ benchmark: "bulk.transaction-prepared", records: N, seconds: round(s), records_per_sec: Math.round(N / s) });
  }

  if (keep("cpu-transform")) {
    const N = smoke ? 50_000 : 500_000;
    const t0 = performance.now();
    let acc = 0;
    for (let i = 0; i < N; i++) {
      // representative CPU work: slug normalize + hash-ish fold
      const sI = `Title Number ${i} Bench!`;
      let h = 0;
      const slug = sI.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      for (let k = 0; k < slug.length; k++) h = (h * 31 + slug.charCodeAt(k)) | 0;
      acc += h;
    }
    const s = (performance.now() - t0) / 1000;
    void acc;
    // Bun Worker verification (per-version: must verify before relying on it).
    let workersOk = false;
    let workerInfo = "unverified";
    try {
      const w = new Worker(new URL("./worker.ts", import.meta.url).href);
      try {
        const result = await new Promise<number>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Worker timed out")), 5000);
          w.onmessage = event => { clearTimeout(timer); resolve(event.data); };
          w.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
          w.postMessage(100);
        });
        workersOk = result === 4950;
        workerInfo = `Bun ${Bun.version}: message/compute round trip ${workersOk ? "verified" : "failed"}`;
      } finally { w.terminate(); }
    } catch (err: any) {
      workerInfo = `Worker unavailable: ${err?.message ?? err}`;
    }
    results.push({
      benchmark: "cpu-transform", records: N, seconds: round(s),
      records_per_sec: Math.round(N / s), extra: { workersOk, workerInfo },
    });
    console.log(`  cpu-transform: ${(N / s).toLocaleString()} rec/s  workers: ${workerInfo}`);
  }

  if (keep("io-transform")) {
    const N = smoke ? 2000 : 20000;
    const CONC = 32;
    const t0 = performance.now();
    let done = 0;
    const one = async (i: number) => {
      await new Promise((r) => setTimeout(r, 1)); // simulated I/O wait
      const v = validateWithSchema(schema, { slug: `s-${i}`, title: `t ${i}`, count: i });
      if (v.success) done++;
    };
    for (let base = 0; base < N; base += CONC) {
      const batch = [];
      for (let i = base; i < Math.min(base + CONC, N); i++) batch.push(one(i));
      await Promise.all(batch);
    }
    const s = (performance.now() - t0) / 1000;
    results.push({ benchmark: "io-transform", records: done, seconds: round(s), records_per_sec: Math.round(done / s), extra: { concurrency: CONC } });
    console.log(`  io-transform: ${(done / s).toLocaleString()} rec/s (conc=${CONC})`);
  }

  if (keep("profile.read-heavy") || keep("profile.write-heavy")) {
    const { service, db } = makeBenchFixture("batch-prof");
    await seedRows(db, smoke ? 500 : 5000);
    const res = (service as any).getResource("item");
    const N = smoke ? 200 : 1000;
    // read-heavy: 75% lists/gets, 15% creates/updates, 10% search
    if (keep("profile.read-heavy")) {
    let t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const m = i % 20;
      if (m < 15) {
        if (m % 2 === 0) await res.list({ input: { limit: 20 }, ctx: silentCtx });
        else await res.get({ input: { id: `seed_${i % 500}` }, ctx: silentCtx });
      } else if (m < 18) {
        await res.create({ input: { slug: `p-${Date.now()}-${i}`, title: `P ${i}`, content: "b" }, ctx: silentCtx });
      } else {
        await res.list({ input: { limit: 20, search: "Benchmark" }, ctx: silentCtx });
      }
    }
    let s = (performance.now() - t0) / 1000;
    results.push({ benchmark: "profile.read-heavy", records: N, seconds: round(s), records_per_sec: Math.round(N / s) });
    console.log(`  read-heavy: ${(N / s).toLocaleString()} ops/s`);
    }
    // write-heavy: 80% creates/updates, 20% reads
    if (keep("profile.write-heavy")) {
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const m = i % 10;
      if (m < 6) {
        await res.create({ input: { slug: `w-${Date.now()}-${i}`, title: `W ${i}`, content: "b" }, ctx: silentCtx });
      } else if (m < 8) {
        await res.update({ input: { id: `seed_${i % 500}`, title: `WU ${i}` }, ctx: silentCtx });
      } else {
        await res.list({ input: { limit: 20 }, ctx: silentCtx });
      }
    }
    const s = (performance.now() - t0) / 1000;
    results.push({ benchmark: "profile.write-heavy", records: N, seconds: round(s), records_per_sec: Math.round(N / s) });
    console.log(`  write-heavy: ${(N / s).toLocaleString()} ops/s`);
    }
  }

  const manifest = collectManifest({ benchmark: "batch", db: "sqlite-memory" });
  const path = await writeJson(`batch-${stamp()}.json`, { manifest, rss_mb: memMb(), results });
  console.log(`\nwrote ${path}`);
}

function round(n: number, d = 3): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
