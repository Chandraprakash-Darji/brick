#!/usr/bin/env bun
/**
 * Microbenchmark suite
 *
 * Covers every row: context creation, action invocation, validation,
 * validation errors, HTTP input assembly, query coercion, service dispatch,
 * cursor handling, sort/filter/select parsing, JSON response, OpenAPI,
 * server init. (Resource query construction lives in bench/prepared.ts;
 * service dispatch HTTP pollution is isolated by keeping this suite
 * fully in-process — no sockets.)
 *
 * Usage:
 *   bun bench/micro.ts [--smoke] [--filter <regex>] [--iters <mult>]
 */
import {
  defineService,
  defineAction,
  createServiceProxy,
  generateOpenApiSpec,
  resetGlobalRegistry,
  validateWithSchema,
  Type,
} from "../packages/core/src/index";
import { createBrickServer } from "../packages/cli/src/server";
import { parseArgs, argStr, fmtNs } from "./lib/stats";
import { collectManifest, writeJson, stamp } from "./lib/manifest";
import {
  makeBenchFixture,
  seedRows,
  silentCtx,
  twentyFieldSchema,
  twentyFieldValue,
  nestedSchema,
  nestedValue,
  payloadOf,
} from "./lib/fixtures";

export interface MicroResult {
  benchmark: string;
  variant: string;
  iters: number;
  ns_per_op: number;
  ops_per_sec: number;
  heap_delta_bytes_per_op: number;
}

async function time(
  benchmark: string,
  variant: string,
  fn: () => unknown,
  iters: number
): Promise<MicroResult> {
  const WARM = Math.min(1000, Math.max(50, Math.floor(iters / 10)));
  for (let i = 0; i < WARM; i++) await fn();
  if (typeof Bun !== "undefined" && typeof (Bun as any).gc === "function") (Bun as any).gc(true);
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) await fn();
  const dtMs = performance.now() - t0;
  const heap1 = process.memoryUsage().heapUsed;
  const ns = (dtMs * 1e6) / iters;
  return {
    benchmark,
    variant,
    iters,
    ns_per_op: Math.round(ns * 100) / 100,
    ops_per_sec: Math.round((iters / (dtMs / 1000)) * 10) / 10,
    heap_delta_bytes_per_op: Math.round(((heap1 - heap0) / iters) * 100) / 100,
  };
}

// Inline copy of the coercion loop in packages/cli/src/server.ts
// (coerceQueryParams, private) so the 0/5/20-field sweep is measurable.
function coerceCopy(query: any, schema: any): any {
  if (!query || !schema || !schema.properties) return query;
  const coerced: Record<string, any> = { ...query };
  for (const [key, prop] of Object.entries(schema.properties) as [string, any][]) {
    const val = query[key];
    if (val === undefined) continue;
    const type = prop?.type;
    if (type === "number" || type === "integer") {
      const num = Number(val);
      if (!isNaN(num)) coerced[key] = num;
    } else if (type === "boolean") {
      if (val === "true" || val === "1") coerced[key] = true;
      else if (val === "false" || val === "0") coerced[key] = false;
    }
  }
  return coerced;
}

function coercionSchema(n: number): any {
  const props: Record<string, any> = {};
  for (let i = 0; i < n; i++) {
    props[`f${i}`] = i % 2 === 0 ? Type.Number() : Type.Boolean();
  }
  return Type.Object(props);
}

function main(): Promise<{ results: MicroResult[]; path: string }> {
  return (async () => {
    const args = parseArgs(process.argv.slice(2));
    const smoke = args["smoke"] === true;
    const filter = args["filter"] ? new RegExp(argStr(args, "filter", ".*")) : /.*/;
    const mult = Number(args["iters"] ?? 1) || 1;
    const N = (n: number) => Math.max(20, Math.floor(((smoke ? n / 10 : n) as number) * mult));

    const results: MicroResult[] = [];
    const run = async (b: string, v: string, fn: () => unknown, iters: number) => {
      if (!filter.test(`${b}/${v}`)) return;
      const r = await time(b, v, fn, N(iters));
      results.push(r);
      console.log(
        `  ${b} [${v}]  ${fmtNs(r.ns_per_op)}/op  ${r.ops_per_sec.toLocaleString()} ops/s  heap ${r.heap_delta_bytes_per_op} B/op`
      );
    };

    console.log("== micro: context creation ==");
    {
      const service = defineService("micro_minimal");
      await run("context", "minimal", () => service.resolveContext(), 5000);
      const hooked = defineService("micro_hook", {
        context: async () => ({ tenantId: "t1", role: "admin" as const }),
      });
      await run("context", "custom-hook", () => hooked.resolveContext(), 5000);
      const pre = await service.resolveContext();
      await run("context", "pre-resolved", () => service.resolveContext(pre as any), 20000);
    }

    console.log("== micro: action invocation ==");
    {
      const { noop, validated, full } = makeBenchFixture("micro-act");
      await run("action", "empty", () => noop.execute({}), 5000);
      const asyncAct = defineAction({ name: "a", execute: async () => ({ ok: true }) });
      await run("action", "async", () => asyncAct.execute({}), 5000);
      const ctx = { user: { id: "bench-user" } };
      await run("action", "auth", () => full.execute({ input: { slug: "ab" }, ctx }), 3000);
      await run(
        "action",
        "context-hook",
        () => validated.execute({ input: { slug: "abc", title: "hey there" } }),
        3000
      );
      void ctx;
    }

    console.log("== micro: validation ==");
    {
      const small = Type.Object({ slug: Type.String(), count: Type.Number() });
      const smallVal = { slug: "abc", count: 3 };
      const big = twentyFieldSchema();
      const bigVal = twentyFieldValue();
      const nested = nestedSchema();
      const nestedVal = nestedValue();
      const arr = Type.Array(Type.Object({ sku: Type.String(), qty: Type.Number() }));
      const arrVal = Array.from({ length: 25 }, (_, i) => ({ sku: `s-${i}`, qty: i }));
      await run("validation", "small-object", () => validateWithSchema(small, smallVal), 20000);
      await run("validation", "20-field", () => validateWithSchema(big, bigVal), 5000);
      await run("validation", "nested", () => validateWithSchema(nested, nestedVal), 5000);
      await run("validation", "arrays", () => validateWithSchema(arr, arrVal), 5000);
    }

    console.log("== micro: validation errors ==");
    {
      const schema = twentyFieldSchema();
      const oneBad = { ...twentyFieldValue(), field_0: "nope" };
      const manyBad = twentyFieldValue(false);
      await run("validation-errors", "one-error", () => validateWithSchema(schema, oneBad), 5000);
      await run("validation-errors", "many-errors", () => validateWithSchema(schema, manyBad), 2000);
    }

    console.log("== micro: http input assembly (in-process app.handle) ==");
    {
      const { service } = makeBenchFixture("micro-http");
      service.action({ name: "getInput", input: Type.Object({ slug: Type.String(), count: Type.Number() }), execute: ({ input }) => input });
      const app = createBrickServer({ services: [service], requestLogging: false, docs: false });
      const getReq = () =>
        new Request(`http://localhost/api/${service.name}/getInput?slug=abc&count=3`, { method: "GET" });
      const postReq = () =>
        new Request(`http://localhost/api/${service.name}/validated`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: "abc", title: "hey there", count: 3 }),
        });
      const handle = async (req: Request) => {
        const res = await app.handle(req);
        if (res.status !== 200) throw new Error(`Unexpected HTTP status ${res.status}`);
        return res.text();
      };
      await run("http-input", "get-query", () => handle(getReq()), 1000);
      await run("http-input", "post-body", () => handle(postReq()), 1000);
    }

    console.log("== micro: query coercion ==");
    {
      const q0 = {};
      const q5 = { f0: "3", f1: "true", f2: "4", f3: "0", f4: "5" };
      const q20: Record<string, string> = {};
      for (let i = 0; i < 20; i++) q20[`f${i}`] = i % 2 === 0 ? String(i) : "true";
      const s0 = coercionSchema(0), s5 = coercionSchema(5), s20 = coercionSchema(20);
      await run("coercion", "0-fields", () => coerceCopy(q0, s0), 50000);
      await run("coercion", "5-fields", () => coerceCopy(q5, s5), 20000);
      await run("coercion", "20-fields", () => coerceCopy(q20, s20), 10000);
    }

    console.log("== micro: service dispatch ==");
    {
      const { service, noop } = makeBenchFixture("micro-dispatch");
      await run("dispatch", "direct-action", () => noop.execute({}), 5000);
      await run(
        "dispatch",
        "getAction",
        () => service.getAction("noop")!.execute({}),
        5000
      );
      const proxy = createServiceProxy<any>(service.name);
      await run("dispatch", "service-proxy", () => (proxy as any).noop(undefined, {}), 2000);
    }

    console.log("== micro: cursor handling ==");
    {
      // Mirrors resource.ts:219 encodeCursor / :223 decodeCursor (base64url JSON).
      const enc = (p: unknown) => Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
      const dec = (c: string) => JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
      const payload = { v: ["2024-01-01T00:00:00.000Z", "itm_abc123"], s: "-updatedAt" };
      const cursor = enc(payload);
      await run("cursor", "encode", () => enc(payload), 20000);
      await run("cursor", "decode", () => dec(cursor), 20000);
    }

    console.log("== micro: sort/filter/select parsing (via resource list) ==");
    {
      const { service, db } = makeBenchFixture("micro-list");
      await seedRows(db, smoke ? 200 : 1000);
      const res = (service as any).getResource("item");
      const q1 = { input: { limit: 20, sort: "-updatedAt" }, ctx: silentCtx };
      const q5 = {
        input: { limit: 20, sort: "-updatedAt", status: "published", search: "title", select: "id,slug", views: 5 },
        ctx: silentCtx,
      };
      const q20: any = { limit: 20, sort: "-updatedAt" };
      for (let i = 0; i < 17; i++) q20[`extra${i}`] = "x";
      await run("resource-parse", "1-param", () => res.list(q1), 300);
      await run("resource-parse", "5-params", () => res.list(q5), 300);
      await run("resource-parse", "20-params", () => res.list({ input: q20, ctx: silentCtx }), 300);
    }

    console.log("== micro: json response ==");
    {
      for (const size of [256, 1024, 16 * 1024, 256 * 1024]) {
        const obj = JSON.parse(payloadOf(size));
        const label = size >= 1024 ? `${size / 1024}KiB` : `${size}B`;
        await run("json", `serialize-${label}`, () => JSON.stringify(obj), size > 16384 ? 200 : 2000);
      }
    }

    console.log("== micro: openapi generation ==");
    {
      for (const count of smoke ? [10, 100] : [10, 100, 1000]) {
        resetGlobalRegistry();
        const svc = defineService(`openapi_${count}`);
        for (let i = 0; i < count; i++) {
          svc.action(
            defineAction({
              name: `act${i}`,
              input: Type.Object({ id: Type.String() }),
              output: Type.Object({ ok: Type.Boolean() }),
              execute: async () => ({ ok: true }),
            })
          );
        }
        await run("openapi", `${count}-actions`, () => generateOpenApiSpec({ services: [svc] }), count >= 1000 ? 3 : 20);
      }
    }

    console.log("== micro: server init ==");
    {
      for (const count of smoke ? [10] : [10, 100, 1000]) {
        resetGlobalRegistry();
        const svc = defineService(`init_${count}`);
        for (let i = 0; i < count; i++) {
          svc.action(defineAction({ name: `a${i}`, execute: async () => ({ ok: true }) }));
        }
        await run(
          "server-init",
          `${count}-actions`,
          () => createBrickServer({ services: [svc], requestLogging: false, docs: false }),
          count >= 100 ? 20 : 50
        );
      }
    }

    const manifest = collectManifest({ benchmark: "micro", db: "none" });
    const path = await writeJson(`micro-${stamp()}.json`, { manifest, results });
    console.log(`\nwrote ${path} (${results.length} results)`);
    return { results, path };
  })();
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
