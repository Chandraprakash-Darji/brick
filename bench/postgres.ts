#!/usr/bin/env bun
/** Optional PostgreSQL lane. Uses only a uniquely named benchmark table. */
import {
  defineDatabase,
  defineService,
  eq,
  sql,
} from "../packages/core/src/index";
import { pgTable, text } from "../packages/core/src/pg";
import { brick } from "../packages/cli/src/server";
import { runLoad } from "./lib/load";
import { parseArgs, argInt, argList, argStr } from "./lib/stats";
import { collectManifest, stamp, writeJson } from "./lib/manifest";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url =
    args.pg === true ? process.env.BENCH_DATABASE_URL : argStr(args, "pg", "");
  const manifest = collectManifest({ benchmark: "postgres", db: "postgres" });
  if (!url) {
    await writeJson(`postgres-${stamp()}.json`, {
      manifest,
      skipped: "Provide --pg URL for a disposable benchmark database",
    });
    console.log("PostgreSQL skipped: no --pg URL supplied");
    return;
  }
  const name = `brick_bench_${crypto.randomUUID().replaceAll("-", "")}`;
  const table = pgTable(name, {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
  });
  const database = defineDatabase({
    engine: "postgres",
    url,
    tables: [table],
    max: 16,
  });
  const db = database.getDb();
  const client = (db as any).$client;
  let app: ReturnType<typeof brick> | undefined;
  let created = false;
  try {
    await client.unsafe(
      `CREATE TABLE "${name}" (id text PRIMARY KEY, title text NOT NULL)`,
    );
    created = true;
    const rows = argInt(args, "rows", args.smoke ? 100 : 1000);
    await client.unsafe(
      `INSERT INTO "${name}" SELECT 'seed_' || i, 'Benchmark ' || i FROM generate_series(0, $1::integer - 1) i`,
      [rows],
    );
    const service = defineService(name, {
      database,
      context: () => ({
        logger: { info() {}, warn() {}, error() {}, debug() {} },
      }),
    });
    service.resource({ name: "item", table, defaultSort: "id" });
    app = brick({ services: [service], docs: false, requestLogging: false });
    app.listen(0);
    const base = `http://127.0.0.1:${app.server!.port}/api/item`;
    const results = [];
    const requests = argInt(args, "requests", args.smoke ? 20 : 500);
    for (const concurrency of argList(
      args,
      "concurrency",
      args.smoke ? [1, 16] : [1, 16, 64, 256],
    )) {
      for (const [op, method, path, body] of [
        ["get", "GET", "/seed_0", undefined],
        ["list", "GET", "?limit=20", undefined],
        ["create", "POST", "", JSON.stringify({ title: "Created" })],
        ["update", "PATCH", "/seed_0", JSON.stringify({ title: "Updated" })],
      ] as const) {
        if (args.filter && !new RegExp(String(args.filter)).test(`pg.${op}`))
          continue;
        const result = await runLoad({
          name: `pg.${op} c=${concurrency}`,
          url: base + path,
          method,
          body,
          headers: { "content-type": "application/json" },
          concurrency,
          requests,
        });
        results.push(result);
        console.log(
          `${result.name}: ${result.goodput_rps} goodput/s, p99=${result.latency.p99_ms}ms, errors=${result.errors}`,
        );
      }
      const ids = Array.from(
        { length: requests },
        (_, i) => `delete_${concurrency}_${i}`,
      );
      for (let i = 0; i < ids.length; i += 1000)
        await db
          .insert(table)
          .values(
            ids.slice(i, i + 1000).map((id) => ({ id, title: "Delete" })),
          );
      let next = 0;
      results.push(
        await runLoad({
          name: `pg.delete c=${concurrency}`,
          url: () => `${base}/${ids[next++]}`,
          method: "DELETE",
          concurrency,
          requests,
        }),
      );
    }
    const query = db
      .select()
      .from(table)
      .where(eq(table.id, "seed_0"))
      .limit(1)
      .toSQL();
    const plans = await client.unsafe(
      `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) ${query.sql}`,
      query.params,
    );
    const version = await db.execute(sql`select version()`);
    await writeJson(`postgres-${stamp()}.json`, {
      manifest,
      table: name,
      dataset_rows: rows,
      results,
      plans,
      version,
      limitations: [
        "RTT injection requires an external proxy/network configuration; not simulated as PostgreSQL measurements",
      ],
    });
  } finally {
    await app?.stop();
    if (created) await client.unsafe(`DROP TABLE "${name}"`);
    await client.end();
  }
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
