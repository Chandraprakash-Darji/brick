#!/usr/bin/env bun
/** Paired compiler/general-handler comparison. External oha; server processes stay separate. */
import {
  defineService,
  resetGlobalRegistry,
  t,
  defineDatabase,
  syncSchema,
  sqliteTable,
  text,
} from "../packages/core/src";
import { brick } from "../packages/cli/src/server";
import { argInt, argStr, median, parseArgs } from "./lib/stats";
import { runLoad } from "./lib/load";
import { collectManifest } from "./lib/manifest";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
if (args.server) {
  resetGlobalRegistry();
  const service = defineService("compile_bench");
  service.action({
    name: "getSync",
    method: "GET",
    execute: () => ({ ok: true }),
  });
  service.action({
    name: "getAsync",
    method: "GET",
    execute: async () => ({ ok: true }),
  });
  const input = t.Object({
    slug: t.String({ minLength: 2 }),
    count: t.Number({ minimum: 0 }),
  });
  const output = t.Object({ ok: t.Boolean() });
  service.action({
    name: "validated",
    input,
    output,
    execute: async () => ({ ok: true }),
  });
  const secure = defineService("secure_bench", {
    context: async (ctx) => ({
      user: { id: ctx.request.headers.get("x-user") },
    }),
  });
  secure.action({
    name: "full",
    input,
    output,
    authorize: async ({ user }) => user?.id === "alice",
    execute: async () => ({ ok: true }),
  });
  const table = sqliteTable("compiler_items", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
  });
  const database = defineDatabase({ tables: [table] });
  const db = database.getDb();
  syncSchema(database.tables, db);
  // Drizzle 0.39 exposes $client at runtime but omits it from BunSQLiteDatabase types.
  const client = (db as typeof db & { $client: import("bun:sqlite").Database })
    .$client;
  let sequence = 0;
  const silent = { info() {}, warn() {}, error() {}, debug() {} };
  const store = defineService("store_bench", {
    database,
    context: () => ({ logger: silent }),
  });
  store.resource({
    name: "item",
    table,
    defaultSort: "id",
    idGenerator: () => `created-${sequence++}`,
  });
  const reset = (count: number, deletion: boolean) => {
    sequence = 0;
    client.exec("DELETE FROM compiler_items");
    const insert = client.prepare(
      "INSERT INTO compiler_items (id, title) VALUES (?, ?)",
    );
    client.transaction(() => {
      for (let i = 0; i < count; i++)
        insert.run(`${deletion ? "delete" : "seed"}-${i}`, `Item ${i}`);
    })();
    return { rows: count };
  };
  const app = brick({
    services: [service, secure, store],
    compiler: args.server === "compiled",
    docs: false,
    requestLogging: false,
  });
  // Fixture management is outside every timed load. Never expose these routes in an application.
  app.post("/__bench/reset", ({ body }: any) =>
    reset(body.count, body.deletion),
  );
  app.get("/__bench/state", () => ({
    rows: client.query("SELECT COUNT(*) AS count FROM compiler_items").get(),
    first: client
      .query("SELECT * FROM compiler_items WHERE id = 'seed-0'")
      .get(),
  }));
  app.listen(0);
  console.log(JSON.stringify({ port: app.server!.port }));
  const stop = async () => {
    await app.stop();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
} else {
  const oha = argStr(args, "oha", "oha");
  const requests = argInt(args, "requests", 50000),
    rounds = argInt(args, "rounds", 5),
    concurrency = argInt(args, "concurrency", 16);
  if (
    ![requests, rounds, concurrency].every(
      (value) => Number.isInteger(value) && value > 0,
    )
  )
    throw new Error(
      "requests, rounds and concurrency must be positive integers",
    );
  const manifest = collectManifest({
    benchmark: "typescript-handler-compiler",
    db: "sqlite-memory",
    concurrency,
  });
  const servers: {
    mode: string;
    port: number;
    process: ReturnType<typeof Bun.spawn>;
  }[] = [];
  const body = JSON.stringify({ slug: "hello", count: 2 });
  type Case = {
    name: string;
    path: string;
    method: string;
    body?: string;
    resource?: boolean;
    deletion?: boolean;
  };
  const allCases: Case[] = [
    { name: "sync", path: "/api/compile_bench/getSync", method: "GET" },
    { name: "async", path: "/api/compile_bench/getAsync", method: "GET" },
    { name: "validated", path: "/api/compile_bench/validated", method: "POST" },
    { name: "context-auth", path: "/api/secure_bench/full", method: "POST" },
    {
      name: "resource-get",
      path: "/api/item/seed-0",
      method: "GET",
      resource: true,
    },
    {
      name: "resource-list",
      path: "/api/item?limit=20",
      method: "GET",
      resource: true,
    },
    {
      name: "resource-create",
      path: "/api/item",
      method: "POST",
      body: '{"title":"Created"}',
      resource: true,
    },
    {
      name: "resource-patch",
      path: "/api/item/seed-0",
      method: "PATCH",
      body: '{"title":"Changed"}',
      resource: true,
    },
    {
      name: "resource-put",
      path: "/api/item/seed-0",
      method: "PUT",
      body: '{"title":"Changed"}',
      resource: true,
    },
    // DELETE needs unique URLs: use the Bun loader because oha samples URL/body files randomly.
    {
      name: "resource-delete",
      path: "/api/item/delete-0",
      method: "DELETE",
      resource: true,
      deletion: true,
    },
  ];
  const selection = argStr(args, "cases", "all");
  const cases =
    selection === "crud" ? allCases.filter((test) => test.resource) : allCases;
  if (!["all", "crud"].includes(selection))
    throw new Error("cases must be all or crud");
  async function reset(port: number, test: Case, count = 100) {
    if (!test.resource) return;
    const response = await fetch(`http://127.0.0.1:${port}/__bench/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        count: test.deletion ? count : 100,
        deletion: Boolean(test.deletion),
      }),
    });
    if (!response.ok) throw new Error("Fixture reset failed");
    await response.text();
  }
  async function load(
    port: number,
    test: (typeof cases)[number],
    count: number,
  ) {
    await reset(port, test, count);
    let result: any;
    if (test.deletion) {
      let id = 0;
      const raw = await runLoad({
        name: test.name,
        url: () => `http://127.0.0.1:${port}/api/item/delete-${id++}`,
        method: "DELETE",
        concurrency,
        requests: count,
      });
      result = {
        summary: {
          successRate: raw.successful / count,
          requestsPerSec: raw.rps,
        },
        latencyPercentiles: { p99: raw.latency.p99_ms / 1000 },
        statusCodeDistribution: raw.statusCodes,
        errorDistribution: raw.errors ? { errors: raw.errors } : {},
        bun_load: raw,
      };
    } else {
      const command = [
        oha,
        "--no-tui",
        "--output-format",
        "json",
        "--http-version",
        "1.1",
        "--disable-compression",
        "--worker-threads",
        "2",
        "-n",
        String(count),
        "-c",
        String(concurrency),
        "-m",
        test.method,
        "-H",
        "x-user: alice",
      ];
      if (test.method !== "GET")
        command.push("-T", "application/json", "-d", test.body ?? body);
      command.push(`http://127.0.0.1:${port}${test.path}`);
      const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      if (code !== 0) throw new Error(`oha failed: ${stderr}`);
      result = JSON.parse(stdout);
    }
    const statuses = result.statusCodeDistribution;
    if (
      result.summary.successRate !== 1 ||
      Object.keys(statuses).length !== 1 ||
      Number(statuses["200"]) !== count ||
      Object.keys(result.errorDistribution).length
    )
      throw new Error(
        `Failed requests in ${test.name}: ${JSON.stringify(result)}`,
      );
    if (test.resource) {
      const state = await (
        await fetch(`http://127.0.0.1:${port}/__bench/state`)
      ).json();
      const expected = test.deletion
        ? 0
        : test.name === "resource-create"
          ? 100 + count
          : 100;
      if (state.rows.count !== expected)
        throw new Error(
          `Incorrect database state after ${test.name}: ${JSON.stringify(state)}`,
        );
      if (
        ["resource-patch", "resource-put"].includes(test.name) &&
        state.first.title !== "Changed"
      )
        throw new Error("Update did not persist");
    }
    return result;
  }
  try {
    for (const mode of args.compare ? ["generic", "compiled"] : ["compiled"]) {
      const child = Bun.spawn(
        [process.execPath, import.meta.path, "--server", mode],
        {
          stdout: "pipe",
          stderr: "inherit",
        },
      );
      const server = { mode, port: 0, process: child };
      servers.push(server);
      const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
      const startup = await Promise.race([
        reader.read(),
        Bun.sleep(5000).then(() => {
          throw new Error("Server startup timed out");
        }),
      ]);
      if (startup.done) throw new Error("Server exited during startup");
      server.port = JSON.parse(new TextDecoder().decode(startup.value)).port;
    }
    for (const test of cases) {
      const responses: string[] = [];
      for (const server of servers) {
        await reset(server.port, test, 1);
        const response = await fetch(
          `http://127.0.0.1:${server.port}${test.path}`,
          {
            method: test.method,
            headers: { "content-type": "application/json", "x-user": "alice" },
            ...(test.method !== "GET"
              ? {
                  body: test.deletion
                    ? '{"id":"delete-0"}'
                    : (test.body ?? body),
                }
              : {}),
          },
        );
        if (response.status !== 200)
          throw new Error(
            `Bad ${test.name} response: ${await response.text()}`,
          );
        responses.push(await response.text());
        await load(server.port, test, Math.min(requests, 10000));
      }
      if (responses.length > 1 && responses[0] !== responses[1])
        throw new Error(`Mismatched ${test.name} benchmark responses`);
    }
    const variants = cases.flatMap((test) =>
      servers.map((server) => ({ test, server })),
    );
    const results: {
      round: number;
      name: string;
      rps: number;
      p99_ms: number;
      oha: any;
    }[] = [];
    for (let round = 0; round < rounds; round++) {
      const shift = round % variants.length;
      const order = [...variants.slice(shift), ...variants.slice(0, shift)];
      if (round % 2) order.reverse();
      for (const { test, server } of order) {
        const raw = await load(server.port, test, requests);
        const row = {
          round,
          name: args.compare ? `${test.name}.${server.mode}` : test.name,
          rps: raw.summary.requestsPerSec,
          p99_ms: raw.latencyPercentiles.p99 * 1000,
          oha: raw,
        };
        results.push(row);
        console.log(
          `${round + 1}/${rounds} ${row.name}: ${Math.round(row.rps).toLocaleString()} RPS, p99 ${row.p99_ms.toFixed(3)} ms`,
        );
      }
    }
    const summary = Object.fromEntries(
      variants.map(({ test, server }) => {
        const name = args.compare ? `${test.name}.${server.mode}` : test.name,
          rows = results.filter((row) => row.name === name);
        return [
          name,
          {
            median_rps: median(rows.map((row) => row.rps)),
            median_p99_ms: median(rows.map((row) => row.p99_ms)),
          },
        ];
      }),
    );
    await mkdir(resolve(import.meta.dir, "results"), { recursive: true });
    const output = resolve(
      import.meta.dir,
      "results",
      `compiler-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    await Bun.write(
      output,
      JSON.stringify(
        {
          manifest,
          timestamp: new Date().toISOString(),
          runtime: Bun.version,
          requests,
          rounds,
          concurrency,
          cases: selection,
          loader:
            "external oha; HTTP/1.1; 2 workers; DELETE uses parent Bun runLoad for unique URLs",
          server_processes_separate: true,
          request_logging: false,
          measured_requests: variants.length * requests * rounds,
          summary,
          results,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(summary, null, 2));
    console.log(output);
  } finally {
    for (const server of servers) server.process.kill("SIGTERM");
    await Promise.all(servers.map((server) => server.process.exited));
  }
}
