import { crud } from "../../packages/crud/src";
/**
 * Shared fixtures for the Brick benchmark lab.
 * One service shape reused by micro / http / prepared / batch suites so
 * numbers are comparable across suites.
 */
import {
  defineService,
  defineAction,
  defineDatabase,
  resetGlobalRegistry,
  syncSchema,
  ensureResourceIndexes,
  ensureSQLiteFts,
  sqliteTable,
  text,
  integer,
  Type,
  type Service,
} from "../../packages/core/src/index";

export const benchTable = sqliteTable("bench_items", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("draft"),
  views: integer("views").notNull().default(0),
  authorId: text("author_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const benchCrudOptions = {
  fields: {
    id: { read: true, filter: ["eq", "in"] },
    slug: {
      read: true,
      create: true,
      update: true,
      filter: ["eq", "contains"],
      sort: true,
    },
    title: {
      read: true,
      create: true,
      update: true,
      filter: ["eq", "contains"],
      sort: true,
    },
    content: { read: true, create: true, update: true },
    status: { read: true, create: true, update: true, filter: ["eq"] },
    views: {
      read: true,
      create: true,
      update: true,
      filter: ["eq", "gte"],
      sort: true,
    },
    authorId: { read: true, filter: ["eq"] },
    createdAt: { read: true, sort: true },
    updatedAt: { read: true, sort: true },
  },
  hooks: {
    beforeCreate: ({
      data,
      ctx,
    }: {
      data: Record<string, unknown>;
      ctx: any;
    }) => {
      data.id = crypto.randomUUID();
      data.authorId = ctx.user?.id ?? null;
      data.createdAt = data.updatedAt = new Date().toISOString();
    },
    beforeUpdate: ({ data }: { data: Record<string, unknown> }) => {
      data.updatedAt = new Date().toISOString();
    },
  },
  defaultLimit: 20,
  maxLimit: 100,
} as const;

let fixtureSeq = 0;

export interface BenchFixture {
  service: Service<any, any>;
  resource: any;
  db: any;
  noop: any;
  validated: any;
  full: any;
}

/** In-memory SQLite service with a resource + layered actions. */
export function makeBenchFixture(tag = "bench"): BenchFixture {
  resetGlobalRegistry();
  fixtureSeq++;
  const database = defineDatabase({ tables: [benchTable] });
  syncSchema(database.tables, database.getDb());
  const db = database.getDb() as any;
  // Brick does no schema management by design — the app owns its database.
  // The bench therefore prepares its own schema explicitly (tables via
  // syncSchema, then secondary indexes + the FTS5 sidecar the ?search= path
  // queries), exactly as an application developer would.
  ensureResourceIndexes(db, benchTable, {
    ownerField: "authorId",
    searchFields: ["title", "slug"],
  });
  ensureSQLiteFts(db, benchTable, ["title", "slug"]);

  const service = defineService(`${tag}_svc_${fixtureSeq}`, {
    database,
    context: async () => ({ tenantId: "tenant_bench" }),
  });

  const resource = service
    .resource({ name: "item", table: benchTable, id: benchTable.id })
    .use(crud(benchCrudOptions));

  const noop = defineAction({
    name: "noop",
    execute: async () => ({ ok: true }),
  });

  const validated = defineAction({
    name: "validated",
    input: Type.Object({
      slug: Type.String({ minLength: 2, maxLength: 100 }),
      title: Type.String({ minLength: 3 }),
      count: Type.Optional(Type.Number({ minimum: 0 })),
    }),
    output: Type.Object({ ok: Type.Boolean(), slug: Type.String() }),
    execute: async ({ input }: any) => ({ ok: true, slug: input.slug }),
  });

  const full = defineAction({
    name: "full",
    input: Type.Object({ slug: Type.String({ minLength: 2 }) }),
    output: Type.Object({ ok: Type.Boolean(), tenant: Type.String() }),
    authorize: async ({ user }: any) => user?.id === "bench-user",
    execute: async ({ ctx }: any) => ({
      ok: true,
      tenant: (ctx as any).tenantId ?? "?",
    }),
  });

  service.action(noop);
  service.action(validated);
  service.action(full);

  return { service, resource, db, noop, validated, full };
}

/** Bulk seed rows in chunks (drizzle batch insert). Returns row count. */
export async function seedRows(
  db: any,
  n: number,
  opts: { prefix?: string } = {},
): Promise<number> {
  const prefix = opts.prefix ?? "seed";
  const now = new Date().toISOString();
  const CHUNK = 1000;
  for (let base = 0; base < n; base += CHUNK) {
    const end = Math.min(base + CHUNK, n);
    const rows: any[] = [];
    for (let i = base; i < end; i++) {
      rows.push({
        id: `${prefix}_${i}`,
        slug: `${prefix.replaceAll("_", "-")}-slug-${i}`,
        title: `Benchmark title ${i}`,
        content: `Benchmark content body for row ${i}.`,
        status: i % 2 === 0 ? "published" : "draft",
        views: i % 1000,
        authorId: i % 2 === 0 ? "bench-user" : "other-user",
        createdAt: now,
        updatedAt: now,
      });
    }
    await db.insert(benchTable).values(rows);
  }
  return n;
}

/** SQLite EXPLAIN QUERY PLAN lines for an enrolled drizzle query. */
export function explainPlan(db: any, drizzleQuery: any): string[] {
  try {
    const q = drizzleQuery.toSQL();
    const client = (db as any).$client;
    const rows = client
      .query(`EXPLAIN QUERY PLAN ${q.sql}`, q.params ?? [])
      .all();
    return rows.map((r: any) => `${r.id}|${r.parent}|${r.notused}|${r.detail}`);
  } catch (err: any) {
    return [`EXPLAIN failed: ${err?.message ?? err}`];
  }
}

/** Silent logger for bench loops: production services inject their own
 * sampled logger; the framework default console logger would flood bench
 * output (resource create logs per row) and distort timings with TTY I/O. */
export const silentLogger = {
  info: (..._a: any[]) => {},
  warn: (..._a: any[]) => {},
  error: (..._a: any[]) => {},
  debug: (..._a: any[]) => {},
};

export const silentCtx = { logger: silentLogger };

/** Payload string of ~sizeBytes JSON. */
export function payloadOf(sizeBytes: number): string {
  const filler = "x".repeat(Math.max(0, sizeBytes - 32));
  return JSON.stringify({ ok: true, data: filler });
}

const _s = (n: number) => `field_${n}`;

export function twentyFieldSchema(): any {
  const props: Record<string, any> = {};
  for (let i = 0; i < 20; i++) {
    props[_s(i)] = i % 3 === 0 ? Type.Number() : Type.String();
  }
  return Type.Object(props);
}

export function twentyFieldValue(valid = true): Record<string, any> {
  const v: Record<string, any> = {};
  for (let i = 0; i < 20; i++) {
    v[_s(i)] = i % 3 === 0 ? i : `value-${i}`;
  }
  if (!valid) {
    v["field_0"] = "not-a-number";
    v["field_3"] = "not-a-number";
    v["field_6"] = "not-a-number";
  }
  return v;
}

export function nestedSchema(): any {
  return Type.Object({
    user: Type.Object({
      id: Type.String(),
      profile: Type.Object({
        name: Type.String(),
        tags: Type.Array(Type.String()),
        address: Type.Object({ city: Type.String(), zip: Type.String() }),
      }),
    }),
    items: Type.Array(Type.Object({ sku: Type.String(), qty: Type.Number() })),
  });
}

export function nestedValue(): any {
  return {
    user: {
      id: "u_1",
      profile: {
        name: "Bench",
        tags: ["a", "b", "c"],
        address: { city: "Berlin", zip: "10115" },
      },
    },
    items: Array.from({ length: 10 }, (_, i) => ({ sku: `sku-${i}`, qty: i })),
  };
}
