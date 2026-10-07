#!/usr/bin/env bun
/**
 * Prepared-query experiment
 * "Prepared-query experiment (run before any ORM rewrite)".
 *
 * Compares dynamic Drizzle builder vs precomputed prepared vs generated
 * raw/prepared SQL across the resource ops. If prepared/generated wins
 * clearly, compiling Brick's query layer is enough — no native ORM needed.
 *
 * Usage: bun bench/prepared.ts [--smoke] [--filter <regex>]
 */
import { eq, sql } from "../packages/core/src/index";
import {
  makeBenchFixture,
  seedRows,
  explainPlan,
  benchTable,
} from "./lib/fixtures";
import { parseArgs, argStr } from "./lib/stats";
import { collectManifest, writeJson, stamp } from "./lib/manifest";

interface Row {
  op: string;
  variant: string;
  us_per_query: number;
  iters: number;
  note?: string;
}

async function timeQuery(
  fn: () => Promise<unknown>,
  iters: number,
): Promise<number> {
  for (let i = 0; i < Math.min(20, iters); i++) await fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) await fn();
  return ((performance.now() - t0) * 1e6) / iters / 1000; // µs
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const smoke = args["smoke"] === true;
  const filter = args["filter"]
    ? new RegExp(argStr(args, "filter", ".*"))
    : /.*/;
  const ITERS = smoke ? 100 : 500;

  const { db } = makeBenchFixture("prepared");
  await seedRows(db, smoke ? 500 : 5000);
  const rows: Row[] = [];
  const keep = (op: string, v: string) => filter.test(`${op}/${v}`);
  const push = async (
    op: string,
    variant: string,
    fn: () => Promise<unknown>,
    note?: string,
  ) => {
    if (!keep(op, variant)) return;
    const us = await timeQuery(fn, ITERS);
    rows.push({
      op,
      variant,
      us_per_query: Math.round(us * 100) / 100,
      iters: ITERS,
      note,
    });
    console.log(
      `  ${op} [${variant}] ${us.toFixed(2)}µs/query${note ? ` (${note})` : ""}`,
    );
  };

  const id = "seed_42";

  // --- get by id ---
  await push("get-by-id", "dynamic-drizzle", () =>
    db.select().from(benchTable).where(eq(benchTable.id, id)).limit(1),
  );

  let preparedGet: any = null;
  try {
    preparedGet = db
      .select()
      .from(benchTable)
      .where(eq(benchTable.id, sql.placeholder("id")))
      .prepare();
    await push("get-by-id", "prepared", () => preparedGet.execute({ id }));
  } catch (err: any) {
    rows.push({
      op: "get-by-id",
      variant: "prepared",
      us_per_query: 0,
      iters: 0,
      note: `unsupported: ${err?.message ?? err}`,
    });
    console.log(`  get-by-id [prepared] skipped: ${err?.message ?? err}`);
  }

  await push("get-by-id", "raw-sql", async () => {
    (db as any).$client
      .query(`SELECT * FROM "bench_items" WHERE "id" = ? LIMIT 1`)
      .get(id);
  });

  // --- list with filter + order + pagination ---
  const listDynamic = () =>
    db
      .select()
      .from(benchTable)
      .where(eq(benchTable.status, "published"))
      .limit(20)
      .offset(40);
  await push("list-filter", "dynamic-drizzle", listDynamic);

  try {
    const preparedList = db
      .select()
      .from(benchTable)
      .where(eq(benchTable.status, sql.placeholder("status")))
      .limit(20)
      .offset(40)
      .prepare();
    await push("list-filter", "prepared", () =>
      preparedList.execute({ status: "published" }),
    );
  } catch (err: any) {
    rows.push({
      op: "list-filter",
      variant: "prepared",
      us_per_query: 0,
      iters: 0,
      note: `unsupported: ${err?.message ?? err}`,
    });
    console.log(`  list-filter [prepared] skipped: ${err?.message ?? err}`);
  }

  await push("list-filter", "raw-sql", async () => {
    (db as any).$client
      .query(
        `SELECT * FROM "bench_items" WHERE "status" = ? LIMIT 20 OFFSET 40`,
      )
      .all("published");
  });

  // --- insert ---
  let n = 0;
  await push("insert", "dynamic-drizzle", () => {
    const i = n++;
    return db.insert(benchTable).values({
      id: `prep_${i}`,
      slug: `prep-slug-${i}`,
      title: `Prep ${i}`,
      content: "b",
      status: "draft",
      views: 0,
      authorId: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
  });
  const insertPrepared = db
    .insert(benchTable)
    .values({
      id: sql.placeholder("id"),
      slug: sql.placeholder("slug"),
      title: "Prepared",
      content: "b",
      status: "draft",
      views: 0,
      authorId: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    })
    .prepare();
  await push("insert", "prepared", () => {
    const i = n++;
    return insertPrepared.execute({
      id: `prepared_${i}`,
      slug: `prepared-slug-${i}`,
    });
  });
  await push("insert", "raw-sql", async () => {
    const i = n++;
    (db as any).$client.run(
      `INSERT INTO "bench_items" ("id","slug","title","content","status","views","created_at","updated_at") VALUES (?,?,?,?,?,?,?,?)`,
      [
        `raw_${i}`,
        `raw-slug-${i}`,
        `Raw ${i}`,
        "b",
        "draft",
        0,
        "2024-01-01T00:00:00.000Z",
        "2024-01-01T00:00:00.000Z",
      ],
    );
  });

  // --- update / delete by id ---
  await push("update-by-id", "dynamic-drizzle", () =>
    db
      .update(benchTable)
      .set({ title: "Prep updated" })
      .where(eq(benchTable.id, id)),
  );
  const updatePrepared = db
    .update(benchTable)
    .set({ title: "Prepared updated" })
    .where(eq(benchTable.id, sql.placeholder("id")))
    .prepare();
  await push("update-by-id", "prepared", () => updatePrepared.execute({ id }));
  await push("update-by-id", "raw-sql", async () => {
    (db as any).$client.run(
      `UPDATE "bench_items" SET "title" = ? WHERE "id" = ?`,
      ["Raw updated", id],
    );
  });
  // Roll back each delete so every invocation deletes a real row. All
  // variants include the same savepoint/rollback overhead.
  const deletePrepared = db
    .delete(benchTable)
    .where(eq(benchTable.id, sql.placeholder("id")))
    .prepare();
  const deleteOnce = async (fn: () => unknown) => {
    db.$client.run("SAVEPOINT bench_delete");
    try {
      return await fn();
    } finally {
      db.$client.run("ROLLBACK TO bench_delete");
      db.$client.run("RELEASE bench_delete");
    }
  };
  await push("delete-by-id", "dynamic-drizzle", () =>
    deleteOnce(() => db.delete(benchTable).where(eq(benchTable.id, id))),
  );
  await push("delete-by-id", "prepared", () =>
    deleteOnce(() => deletePrepared.execute({ id })),
  );
  await push("delete-by-id", "raw-sql", () =>
    deleteOnce(() =>
      db.$client.run(`DELETE FROM "bench_items" WHERE "id" = ?`, [id]),
    ),
  );

  const plans: Record<string, string[]> = {
    "get-by-id": explainPlan(
      db,
      db.select().from(benchTable).where(eq(benchTable.id, id)).limit(1),
    ),
    "list-filter": explainPlan(
      db,
      db
        .select()
        .from(benchTable)
        .where(eq(benchTable.status, "published"))
        .limit(20),
    ),
  };

  const manifest = collectManifest({
    benchmark: "prepared-query",
    db: "sqlite-memory",
    dataset_rows: smoke ? 500 : 5000,
  });
  const path = await writeJson(`prepared-${stamp()}.json`, {
    manifest,
    rows,
    plans,
  });
  console.log(`\nwrote ${path}`);

  const dyn = (op: string) =>
    rows.find((r) => r.op === op && r.variant === "dynamic-drizzle")
      ?.us_per_query ?? 0;
  const prep = (op: string) =>
    rows.find((r) => r.op === op && r.variant === "prepared")?.us_per_query ??
    0;
  for (const op of ["get-by-id", "list-filter"]) {
    if (dyn(op) && prep(op)) {
      console.log(
        `verdict ${op}: prepared is ${(dyn(op) / prep(op)).toFixed(2)}x dynamic-drizzle`,
      );
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
