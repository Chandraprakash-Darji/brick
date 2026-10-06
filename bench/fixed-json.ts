/** Fixed JSON over HTTP: no database, schemas, auth hooks, or logging. */
import { Elysia } from "elysia";
import { defineService, resetGlobalRegistry } from "../packages/core/src/index";
import { createBrickServer } from "../packages/cli/src/server";
import { compilePlans } from "../packages/cli/src/plans";
import { runLoad, type LoadResult } from "./lib/load";
import { collectManifest, stamp, writeJson } from "./lib/manifest";
import { argInt, median, parseArgs } from "./lib/stats";

const args = parseArgs(process.argv.slice(2));
const requests = argInt(args, "requests", 50000);
const rounds = argInt(args, "rounds", 5);
const concurrency = argInt(args, "concurrency", 16);
if (![requests, rounds, concurrency].every(n => Number.isInteger(n) && n > 0)) {
  throw new Error("requests, rounds, and concurrency must be positive integers");
}
resetGlobalRegistry();
const service = defineService("fixed");
service.action({ name: "getFixed", execute: () => ({ ok: true }) });
service.action({ name: "getAsync", execute: async () => ({ ok: true }) });
if (service.getDb() !== undefined) throw new Error("Fixed JSON benchmark must not have a database");
const plans = await compilePlans([service]);
if (plans.resources.length !== 0) throw new Error("Unexpected resource query plans");
const apps: { stop: () => unknown }[] = [];
let floor: ReturnType<typeof Bun.serve> | undefined;
try {
  floor = Bun.serve({ port: 3481, fetch: () => Response.json({ ok: true }) });
  const elysia = new Elysia().get("/fixed", () => ({ ok: true }));
  apps.push(elysia);
  elysia.listen(3482);
  const brick = createBrickServer({ services: [service], docs: false, requestLogging: false });
  apps.push(brick);
  brick.endpoint({ method: "GET", path: "/fixed", handler: () => ({ ok: true }) });
  brick.listen(3483);
  const compiled = createBrickServer({ services: [service], plans, docs: false, requestLogging: false });
  apps.push(compiled);
  compiled.listen(3484);
  const url = (port: number, path: string) => `http://127.0.0.1:${port}${path}`;
  const variants = [
    { name: "bun", url: `http://127.0.0.1:${floor.port}/fixed` },
    { name: "elysia", url: url(3482, "/fixed") },
    { name: "brick-raw", url: url(3483, "/fixed") },
    { name: "brick-action", url: url(3483, "/api/fixed/getFixed") },
    { name: "brick-async-action", url: url(3483, "/api/fixed/getAsync") },
    { name: "brickc-action", url: url(3484, "/api/fixed/getFixed") },
  ];
  const run = async (variant: typeof variants[number], count: number) => {
    const result = await runLoad({ url: variant.url, name: variant.name, concurrency, requests: count });
    if (result.errors || result.successful !== count) throw new Error(`${variant.name}: HTTP errors`);
    if (result.bytes_in !== count * 11) throw new Error(`${variant.name}: response size mismatch`);
    const { latencies_ms, ...summary } = result;
    return summary;
  };
  for (const variant of variants) {
    const response = await fetch(variant.url);
    const body = await response.text();
    if (response.status !== 200 || body !== '{"ok":true}') {
      throw new Error(`${variant.name}: response mismatch at ${variant.url}: ${response.status} ${body}`);
    }
    await run(variant, 5000);
  }
  const results: (Omit<LoadResult, "latencies_ms"> & { round: number })[] = [];
  for (let round = 0; round < rounds; round++) {
    // Rotate starting variant and reverse on alternate rounds to reduce order bias.
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
  console.log(await writeJson(`fixed-json-${stamp()}.json`, {
    manifest: collectManifest({ benchmark: "fixed-json-no-db", db: "none", dataset_rows: 0, concurrency }),
    method: "GET", response: { ok: true }, request_body: null,
    logging: false, schemas: false, context_hooks: false, authorization: false,
    requests, rounds, concurrency, summary, results,
  }));
} finally {
  floor?.stop(true);
  for (const app of apps) await app.stop();
}
