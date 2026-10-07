#!/usr/bin/env bun
/**
 * Benchmark HTTP server
 *
 * Progressive framework-tax layers, each with an equivalent `{ok:true}`-ish
 * response and identical HTTP settings:
 *
 *   Bun.serve floor  →  direct Elysia  →  Brick raw endpoint
 *     →  Brick no-schema action  →  Brick validated action
 *     →  Brick context/auth action  →  Brick resource + SQLite
 *
 * Standalone: `bun bench/http-server.ts [--port 3456] [--rows 5000] [--db file:/tmp/bench.sqlite]`
 * Library:    `startFloorServer`, `startElysiaServer`, `startBrickServer`
 *             used by bench/http.ts (in-process, no separate process needed).
 */
import { Elysia } from "elysia";
import {
  defineDatabase,
  syncSchema,
  ensureResourceIndexes,
  ensureSQLiteFts,
  type Service,
} from "../packages/core/src/index";
import { brick } from "../packages/cli/src/server";
import { benchTable } from "./lib/fixtures";
import { seedRows } from "./lib/fixtures";
import { parseArgs, argInt, argStr } from "./lib/stats";

export const BENCH_PORTS = {
  floor: 3451,
  elysia: 3452,
  brick: 3453,
  brickFile: 3454,
};

/** Layer 1: runtime floor — bare Bun.serve, no framework. */
export function startFloorServer(port: number) {
  return Bun.serve({
    port,
    fetch: () => Response.json({ ok: true }),
  });
}

/** Layer 2: direct Elysia, no Brick. Measures the Elysia tax. */
export async function startElysiaServer(port: number) {
  const app = new Elysia()
    .get("/__bench/noop", () => ({ ok: true }))
    .post("/__bench/noop", () => ({ ok: true }));
  app.listen(port);
  return app;
}

export interface BrickBench {
  app: any;
  service: Service<any, any>;
  db: any;
  stop: () => void | Promise<void>;
}

/** Layers 3–7: Brick server (raw endpoint + actions + resource + extras). */
export async function startBrickServer(opts: {
  port: number;
  rows?: number;
  dbPath?: string;
  prefix?: string;
}): Promise<BrickBench> {
  const { defineService, defineAction, Type } =
    await import("../packages/core/src/index");
  const { resetGlobalRegistry } = await import("../packages/core/src/index");

  resetGlobalRegistry();
  const database =
    opts.dbPath && opts.dbPath !== ":memory:"
      ? defineDatabase({ tables: [benchTable], path: opts.dbPath })
      : defineDatabase({ tables: [benchTable] });
  syncSchema(database.tables, database.getDb());
  const db = database.getDb() as any;
  // Brick does no schema management by design — the app owns its database.
  // The bench prepares its own schema explicitly (tables, indexes, FTS5
  // sidecar), exactly as an application developer would.
  ensureResourceIndexes(db, benchTable, {
    ownerField: "authorId",
    searchFields: ["title", "slug"],
  });
  ensureSQLiteFts(db, benchTable, ["title", "slug"]);

  const service = defineService("bench", { database });
  const authService = defineService("bench_auth", {
    database,
    // Test hook: promotes the x-user-id header to ctx.user so the
    // authorize leg measures a 200 path (not a 403) with equivalent responses.
    context: async (ctx: any) => {
      const headerUser = ctx?.metadata?.headers?.["x-user-id"];
      return {
        tenantId: "tenant_bench",
        ...(headerUser ? { user: { id: headerUser } } : {}),
      };
    },
  });

  service.resource({
    name: "item",
    table: benchTable,
    ownerField: "authorId",
    operations: { list: { defaultLimit: 20, maxLimit: 100 } },
  });

  service.action(
    defineAction({ name: "noop", execute: async () => ({ ok: true }) }),
  );
  service.action(
    defineAction({
      name: "validated",
      input: Type.Object({
        slug: Type.String({ minLength: 2, maxLength: 100 }),
        title: Type.String({ minLength: 3 }),
        count: Type.Optional(Type.Number({ minimum: 0 })),
      }),
      output: Type.Object({ ok: Type.Boolean() }),
      execute: async () => ({ ok: true }),
    }),
  );
  authService.action(
    defineAction({
      name: "full",
      path: "/api/bench/full",
      method: "POST",
      input: Type.Object({
        slug: Type.String({ minLength: 2, maxLength: 100 }),
        title: Type.String({ minLength: 3 }),
        count: Type.Optional(Type.Number({ minimum: 0 })),
      }),
      output: Type.Object({ ok: Type.Boolean() }),
      authorize: async ({ user }: any) => user?.id === "bench-user",
      execute: async () => ({ ok: true }),
    }),
  );
  // Synthetic N-round-trip action: value-of-removed-round-trips demo
  // (used when no real PostgreSQL is available; labelled synthetic).
  service.action(
    defineAction({
      name: "roundtrips",
      input: Type.Object({ trips: Type.Number({ minimum: 1, maximum: 10 }) }),
      output: Type.Object({ ok: Type.Boolean(), trips: Type.Number() }),
      execute: async ({ input }: any) => {
        for (let i = 0; i < input.trips; i++) {
          await new Promise((r) => setTimeout(r, 3)); // ~3ms simulated RTT
        }
        return { ok: true, trips: input.trips };
      },
    }),
  );
  service.action(
    defineAction({
      name: "slow",
      output: Type.Object({ ok: Type.Boolean() }),
      execute: async () => {
        await new Promise((r) => setTimeout(r, 25)); // one slow query under load
        return { ok: true };
      },
    }),
  );

  const app = brick({
    services: [service, authService],
    requestLogging: false,
    docs: false,
    prefix: opts.prefix ?? "/api",
  });

  // Raw endpoint layer (outside the JSON action mesh).
  app.endpoint({
    method: "POST",
    path: "/__bench/noop",
    handler: () => ({ ok: true }),
  });

  // Sized JSON / payload / streaming routes for parse+serialize scaling.
  const sizes: Record<string, number> = {
    "1kib": 1024,
    "32kib": 32 * 1024,
    "256kib": 256 * 1024,
  };
  for (const [name, bytes] of Object.entries(sizes)) {
    const body = JSON.stringify({
      ok: true,
      data: "x".repeat(Math.max(0, bytes - 32)),
    });
    app.endpoint({
      method: "GET",
      path: `/__bench/json/${name}`,
      handler: () =>
        new Response(body, { headers: { "content-type": "application/json" } }),
    });
    app.endpoint({
      method: "POST",
      path: `/__bench/echo/${name}`,
      handler: async (ctx: any) => ({
        ok: true,
        bytes: JSON.stringify(ctx.body ?? {}).length,
      }),
    });
  }
  for (const mib of [1, 10, 100])
    app.endpoint({
      method: "GET",
      path: `/__bench/stream/${mib}mib`,
      handler: () => {
        const chunk = "x".repeat(64 * 1024);
        let sent = 0;
        const stream = new ReadableStream({
          pull(controller) {
            if (sent >= 16 * mib) return controller.close();
            sent++;
            controller.enqueue(new TextEncoder().encode(chunk));
          },
        });
        return new Response(stream, {
          headers: { "content-type": "application/octet-stream" },
        });
      },
    });

  const rows = opts.rows ?? 5000;
  if (rows > 0) await seedRows(db, rows);

  app.listen(opts.port);
  return {
    app,
    service,
    db,
    stop: async () => {
      await app.stop();
      db.$client.close();
    },
  };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const port = argInt(args, "port", BENCH_PORTS.brick);
  const rows = argInt(args, "rows", 5000);
  const dbArg = argStr(args, "db", ":memory:");
  const bench = await startBrickServer({
    port,
    rows,
    dbPath: dbArg.startsWith("file:") ? dbArg.slice(5) : ":memory:",
  });
  console.log(
    `brick bench server on http://127.0.0.1:${port} (rows=${rows} db=${dbArg})`,
  );
  console.log(`  POST /__bench/noop            raw endpoint`);
  console.log(`  POST /api/bench/noop          no-schema action`);
  console.log(`  POST /api/bench/validated     input+output validation`);
  console.log(
    `  POST /api/bench/full          context hook + authorize (user bench-user)`,
  );
  console.log(`  CRUD /api/item(/:id)          resource + database`);
  const stop = async () => {
    await bench.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => {});
}
