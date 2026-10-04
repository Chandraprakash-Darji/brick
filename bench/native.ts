import { createNativeWorker } from "../packages/cli/src/native-worker";
import { defineDatabase, defineService, sqliteTable, text, getGlobalRegistry, t, eq } from "../packages/core/src/index";
import { compilePlans } from "../packages/cli/src/plans";
/** Experimental native HTTP/list server vs isolated Bun and Brick servers. */
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { runLoad } from "./lib/load";
import { collectManifest, stamp, writeJson } from "./lib/manifest";
import { parseArgs, argInt, argStr, median } from "./lib/stats";

const args = parseArgs(process.argv.slice(2));
const requests = argInt(args, "requests", 20000);
const rounds = argInt(args, "rounds", 5);
const concurrency = argInt(args, "concurrency", 16);
const oha = argStr(args, "oha", "");
const integrated = args["integrated"] === true;
const inprocess = args["inprocess"] === true;
if (inprocess && !integrated) throw new Error("--inprocess requires --integrated");
const loaderVersion = oha ? Bun.spawnSync([oha, "--version"]).stdout.toString().trim() : `bun-${Bun.version} built-in`;
if (![requests, rounds, concurrency].every(n => Number.isInteger(n) && n > 0)) throw new Error("Invalid load arguments");
const directory = await mkdtemp(resolve(tmpdir(), "brick-native-"));
const path = resolve(directory, "bench.sqlite");
const children: ReturnType<typeof Bun.spawn>[] = [];
let fixtureDb: Database | undefined;
const ports = { bun: 3491, elysia: 3492, brick: 3493, rust: 3494, worker: 3495, inprocess: 3496 };
const base = (name: keyof typeof ports) => `http://127.0.0.1:${ports[name]}`;
try {
  const db = fixtureDb = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  {
    db.exec("CREATE TABLE bench_items (id TEXT PRIMARY KEY, title TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO bench_items VALUES (?, ?)");
    db.transaction(() => {
      for (let i = 0; i < 5000; i++) insert.run(`seed_${String(i).padStart(5, "0")}`, `Benchmark title ${i}`);
    })();
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
  for (const mode of ["bun", "elysia", "brick"] as const) {
    children.push(Bun.spawn([process.execPath, resolve(import.meta.dir, "native-server.ts"), mode, String(ports[mode]), path], { stdout: "inherit", stderr: "inherit" }));
  }
  if (integrated) children.push(Bun.spawn([process.execPath, resolve(import.meta.dir, "native-server.ts"), "worker", String(ports.worker), path], { stdout: "inherit", stderr: "inherit" }));
  let nativeCommand: string[];
  if (integrated) {
    const table = sqliteTable("bench_items", { id: text("id").primaryKey(), title: text("title").notNull() });
    const service = defineService("bench", { database: defineDatabase({ tables: [table], path }) });
    service.resource({ name: "item", pluralName: "records", table, defaultSort: "id", excludeFromList: [],
      operations: { list: { defaultLimit: 20, maxLimit: 100 } } });
    service.action({ name: "getFixed", path: "/fixed", method: "GET", execute: () => ({ ok: true }) });
    service.action({ name: "getCustom", execute: () => ({ ok: true, executedBy: "typescript" }) });
    service.action({ name: "getPage", path: "/api/public/pages/:slug", method: "GET",
      input: t.Object({ slug: t.String() }), output: t.Object({ id: t.String(), title: t.String() }),
      errors: { NOT_FOUND: { status: 404, message: "Page not found" } }, execute: async ({ input, ctx, error }) => {
        const [page] = await ctx.db.select().from(table).where(eq(table.id, input.slug));
        if (!page) error.NOT_FOUND("Page not found");
        return page;
      } });
    const plansPath = resolve(directory, "plans.json");
    const databasesPath = resolve(directory, "databases.json");
    await compilePlans([service], { compiler: resolve(import.meta.dir, "../native/brickc/target/release/brickc"), native: true, output: plansPath });
    await Bun.write(databasesPath, JSON.stringify({ bench: path }));
    const architecturePath = resolve(directory, "architecture.json");
    await Bun.write(architecturePath, JSON.stringify(getGlobalRegistry().exportArchitecture()));
    const documentsPath = resolve(directory, "documents.json");
    await Bun.write(documentsPath, JSON.stringify(createNativeWorker({ services: [service] }).nativeDocuments()));
    if (inprocess) children.push(Bun.spawn([process.execPath, resolve(import.meta.dir, "native-server.ts"), "inprocess", String(ports.inprocess), path, plansPath], { stdout: "inherit", stderr: "inherit" }));
    nativeCommand = [resolve(import.meta.dir, "../native/brick-http/target/release/brick-http"),
      "--plans", plansPath, "--databases", databasesPath, "--architecture", architecturePath, "--documents", documentsPath, "--upstream", base("worker"), "--listen", `127.0.0.1:${ports.rust}`];
  } else {
    nativeCommand = [resolve(import.meta.dir, "../native/brick-http/target/release/brick-http-bench"),
      String(ports.rust), path, `${base("brick")}/api/bench/getCustom`];
  }
  children.push(Bun.spawn(nativeCommand, { stdout: "inherit", stderr: "inherit" }));
  for (const name of [...["bun", "elysia", "brick", "rust"] as const, ...(inprocess ? ["inprocess"] as const : [])]) {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (children.some(child => child.exitCode !== null)) throw new Error("Server exited during startup");
      try {
        const response = await fetch(`${base(name)}/fixed`, { signal: AbortSignal.timeout(1000) });
        if (response.ok && await response.text() === '{"ok":true}') { ready = true; break; }
      } catch {}
      await Bun.sleep(50);
    }
    if (!ready) throw new Error(`${name} failed readiness check`);
  }
  const variants = [
    ...(["bun", "elysia", "brick", "rust"] as const).map(name => ({ name: name === "rust" && integrated ? "fixed.rust-proxy" : `fixed.${name}`, url: `${base(name)}/fixed` })),
    ...(["bun", "brick", "rust"] as const).map(name => ({ name: `list.${name}`, url: `${base(name)}/api/item?limit=20` })),
    ...(integrated ? (["bun", "brick", "rust"] as const).map(name => ({ name: `get.${name}`, url: `${base(name)}/api/item/seed_00000` })) : []),
    { name: "custom.brick-direct", url: `${base("brick")}/api/bench/getCustom` },
    ...(integrated ? [
      { name: "health.brick", url: `${base("brick")}/_health` },
      { name: "health.rust", url: `${base("rust")}/_health` },
      { name: "architecture.brick", url: `${base("brick")}/_brick/services` },
      { name: "architecture.rust", url: `${base("rust")}/_brick/services` },
    ] : []),
    { name: integrated ? "custom.rust-to-worker" : "custom.rust-to-brick", url: integrated ? `${base("rust")}/api/bench/getCustom` : `${base("rust")}/custom` },
    ...(inprocess ? [
      { name: "fixed.inprocess", url: `${base("inprocess")}/fixed` },
      { name: "custom.inprocess", url: `${base("inprocess")}/api/bench/getCustom` },
      { name: "get.inprocess", url: `${base("inprocess")}/api/item/seed_00000` },
      { name: "list.inprocess", url: `${base("inprocess")}/api/item?limit=20` },
      ...(["brick", "rust", "inprocess"] as const).map(name => ({ name: `page.${name}`, url: `${base(name)}/api/public/pages/seed_00000` })),
      ...(["brick", "rust", "inprocess"] as const).map(name => ({ name: `docs.${name}`, url: `${base(name)}/docs` })),
    ] : []),
  ];
  // Check full response equivalence, pagination boundaries, validation, and custom dispatch.
  for (const suffix of ["?limit=20", "?limit=5&offset=10", "?limit=20&offset=4990", "?limit=20&offset=5000"]) {
    const responses = await Promise.all((["bun", "brick", "rust"] as const).map(async name => {
      const response = await fetch(`${base(name)}/api/item${suffix}`);
      if (!response.ok) throw new Error(`${name}: ${response.status}`);
      return response.json();
    }));
    if (!responses.every(body => isDeepStrictEqual(body, responses[0]))) throw new Error(`List response mismatch: ${suffix}`);
  }
  for (const name of ["bun", "brick", "rust"] as const) {
    if ((await fetch(`${base(name)}/api/item?limit=0`)).status !== 400) throw new Error(`${name}: invalid limit accepted`);
  }
  const custom = await fetch(integrated ? `${base("rust")}/api/bench/getCustom` : `${base("rust")}/custom`).then(r => r.json());
  if (!isDeepStrictEqual(custom, { ok: true, executedBy: "typescript" })) throw new Error("Custom dispatch failed");
  if (inprocess) {
    for (const path of ["/api/public/pages/seed_00000", "/docs", "/api/item/seed_00000", "/api/item?limit=20"]) {
      const bodies = await Promise.all((["brick", "rust", "inprocess"] as const).map(name => fetch(`${base(name)}${path}`).then(r => path === "/docs" ? r.text() : r.json())));
      if (!bodies.every(body => isDeepStrictEqual(body, bodies[0]))) throw new Error(`Bridge response mismatch: ${path}`);
    }
  }
  const sizes = new Map<string, number>();
  for (const variant of variants) {
    const response = await fetch(variant.url);
    if (!response.ok) throw new Error(`${variant.name}: failed response`);
    sizes.set(variant.name, (await response.bytes()).length);
  }
  const run = async (variant: typeof variants[number], count: number) => {
    if (oha) {
      const child = Bun.spawn([oha, "--no-tui", "--output-format", "json", "--http-version", "1.1", "--worker-threads", "2",
        "-n", String(count), "-c", String(concurrency), variant.url], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (code !== 0) throw new Error(`oha failed: ${stderr}`);
      const raw = JSON.parse(stdout);
      if (raw.summary.successRate !== 1 || raw.statusCodeDistribution["200"] !== count ||
          Object.keys(raw.errorDistribution).length || (!variant.name.startsWith("health.") && raw.summary.totalData !== count * sizes.get(variant.name)!)) {
        throw new Error(`${variant.name}: oha errors or response mismatch`);
      }
      return { name: variant.name, goodput_rps: raw.summary.requestsPerSec,
        latency: { p99_ms: raw.latencyPercentiles.p99 * 1000 },
        measurement_scope: "closed-loop; oha and every target server in separate processes; two oha worker threads; one Rust server event-loop thread",
        oha: raw };
    }
    const result = await runLoad({ name: variant.name, url: variant.url, concurrency, requests: count });
    if (result.errors || result.successful !== count || (!variant.name.startsWith("health.") && result.bytes_in !== count * sizes.get(variant.name)!)) throw new Error(`${variant.name}: errors or response length mismatch`);
    const { latencies_ms, ...summary } = result;
    return { ...summary, measurement_scope: "closed-loop; servers in separate processes; CPU/RSS/event-loop metrics refer ONLY to the loader" };
  };
  for (const variant of variants) await run(variant, 2000);
  const results: { name: string; goodput_rps: number; latency: { p99_ms: number }; round: number }[] = [];
  for (let round = 0; round < rounds; round++) {
    const offset = round % variants.length;
    const order = [...variants.slice(offset), ...variants.slice(0, offset)];
    if (round % 2) order.reverse();
    for (const variant of order) {
      const result = await run(variant, requests);
      results.push({ round, ...result });
      console.log(`${round + 1}: ${variant.name} ${result.goodput_rps.toLocaleString()} RPS p99=${result.latency.p99_ms}ms`);
    }
  }
  const summary = Object.fromEntries(variants.map(variant => {
    const samples = results.filter(r => r.name === variant.name);
    return [variant.name, {
      median_goodput_rps: median(samples.map(r => r.goodput_rps)),
      median_p99_ms: median(samples.map(r => r.latency.p99_ms)),
      min_goodput_rps: Math.min(...samples.map(r => r.goodput_rps)),
      max_goodput_rps: Math.max(...samples.map(r => r.goodput_rps)),
    }];
  }));
  console.log(JSON.stringify(summary, null, 2));
  console.log(await writeJson(`native-${stamp()}.json`, {
    manifest: collectManifest({ benchmark: inprocess ? "native-in-process-bridge" : integrated ? "native-runtime-artifact-router" : "native-runtime-prototype", db: "sqlite-file-shared", dataset_rows: 5000, concurrency }),
    inprocess_bridge: inprocess,
    prototype: !integrated, native_artifact_router: integrated, loader: loaderVersion,
    custom_worker: integrated ? "Bun.serve, no Elysia" : "Brick Elysia",
    server_processes_separate: true, rust_runtime_threads: 1, rust_sqlite_version: "bundled-rusqlite",
    list_shape: "id,title; count + page query; order id asc; limit=20; offset=0; cursor and duplicate items/records arrays",
    requests, rounds, concurrency, summary, results,
  }));
} finally {
  for (const child of children) if (child.exitCode === null) child.kill();
  await Promise.all(children.map(child => child.exited));
  fixtureDb?.close();
  await rm(directory, { recursive: true });
}
