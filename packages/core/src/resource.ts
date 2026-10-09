import type { TSchema } from "@sinclair/typebox";
import {
  getTableColumns,
  entityKind,
  is,
  SQL,
  Column,
  getTableName,
  eq,
  and,
  or,
  like,
  ilike,
  asc,
  desc,
  lt,
  gt,
  lte,
  gte,
  sql,
} from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { buildFtsMatchQuery } from "./db";
import { t } from "./typebox";
import { defineAction } from "./action";
import type {
  Resource,
  ResourceConfig,
  ResourceTypeOptions,
  ResourcePlan,
  Service,
  ActionContext,
} from "./types";

function getColumn(table: any, fieldName: string) {
  if (table[fieldName]) return table[fieldName];
  const cols = getTableColumns(table);
  if (cols[fieldName]) return cols[fieldName];
  for (const col of Object.values(cols)) {
    if ((col as any).name === fieldName) return col;
  }
  return undefined;
}

const RESERVED_LIST_KEYS = new Set([
  "limit",
  "offset",
  "page",
  "sort",
  "search",
  "select",
  "order",
  "orderBy",
  "cursor",
]);

function isStringColumn(col: any): boolean {
  const dt = col.dataType;
  const ct = col.columnType;
  return (
    dt === "string" ||
    ct === "SQLiteText" ||
    ct === "PgText" ||
    ct === "PgVarchar" ||
    ct === "PgChar" ||
    (typeof ct === "string" && ct.toLowerCase().includes("text"))
  );
}

function resolveSearchColumns(
  table: any,
  columns: Record<string, any>,
  explicit?: string[],
): any[] {
  if (explicit && explicit.length > 0) {
    const out: any[] = [];
    for (const f of explicit) {
      const col = getColumn(table, f);
      if (col) out.push(col);
    }
    if (out.length > 0) return out;
  }
  // Prefer conventional searchable fields when present (Go DSL: slug, title).
  const preferred = ["title", "slug", "name", "email"];
  const found: any[] = [];
  for (const key of preferred) {
    const col = getColumn(table, key);
    if (col && isStringColumn(col)) found.push(col);
  }
  if (found.length > 0) return found;
  // Fallback: all string columns except id / owner-like / content bodies.
  const out: any[] = [];
  for (const [key, col] of Object.entries(columns)) {
    const name = (col as any).name ?? key;
    if (key === "id" || name === "id") continue;
    if (key === "userId" || name === "user_id") continue;
    if (key === "content" || name === "content") continue;
    if (isStringColumn(col)) out.push(col);
  }
  return out;
}

function parseSelectParam(
  table: any,
  columns: Record<string, any>,
  select: string[] | string | undefined,
): Record<string, any> | undefined {
  if (!select) return undefined;
  const names: string[] = Array.isArray(select)
    ? select.flatMap((s) => String(s).split(","))
    : String(select)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  if (names.length === 0) return undefined;
  const proj: Record<string, any> = {};
  for (const n of names) {
    const col = getColumn(table, n);
    if (col) {
      // Key by drizzle key so row shape stays consistent.
      const key =
        Object.keys(columns).find((k) => columns[k] === col) ??
        (col as any).name ??
        n;
      proj[key] = col;
    }
  }
  return Object.keys(proj).length > 0 ? proj : undefined;
}

/** Default list exclusion: large body columns (Go pageMeta parity). */
function defaultListProjection(
  table: any,
  columns: Record<string, any>,
  exclude?: string[],
): Record<string, any> | undefined {
  const excluded = exclude ?? ["content"];
  const names = new Set(excluded.map((s) => s.trim()).filter(Boolean));
  if (names.size === 0) return undefined;
  const hasAny = Object.keys(columns).some(
    (k) => names.has(k) || names.has((columns[k] as any).name),
  );
  if (!hasAny) return undefined;
  const proj: Record<string, any> = {};
  for (const [key, col] of Object.entries(columns)) {
    if (names.has(key) || names.has((col as any).name)) continue;
    proj[key] = col;
  }
  return Object.keys(proj).length > 0 ? proj : undefined;
}

interface ParsedSort {
  field: string;
  dir: "asc" | "desc";
}

function parseSortEntries(sort: string | string[] | undefined): ParsedSort[] {
  const parts: string[] = Array.isArray(sort)
    ? sort.flatMap((s) => String(s).split(","))
    : String(sort ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  const out: ParsedSort[] = [];
  for (const part of parts) {
    let field = part;
    let dir: "asc" | "desc" | undefined;
    if (field.startsWith("-")) {
      field = field.slice(1);
      dir = "desc";
    } else if (field.startsWith("+")) {
      field = field.slice(1);
      dir = "asc";
    } else if (field.includes(":")) {
      const [f, d] = field.split(":");
      field = f.trim();
      dir = d.trim().toLowerCase() === "desc" ? "desc" : "asc";
    }
    if (!field) continue;
    out.push({ field, dir: dir ?? "asc" });
  }
  return out;
}

function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor<T>(cursor: string): T | null {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function rowValue(row: any, field: string, col: any): any {
  if (row == null) return undefined;
  if (field in row) return row[field];
  const name = col?.name;
  if (name && name in row) return row[name];
  return undefined;
}

function columnToTypeBox(col: any, customSchema?: TSchema): TSchema {
  if (customSchema) return customSchema;

  const dataType = col.dataType;
  const columnType = col.columnType;

  if (dataType === "boolean" || columnType === "SQLiteBoolean") {
    return t.Boolean();
  }

  if (
    dataType === "number" ||
    columnType === "SQLiteInteger" ||
    columnType === "SQLiteReal"
  ) {
    return t.Number();
  }

  if (dataType === "string" || columnType === "SQLiteText") {
    if (col.enumValues && col.enumValues.length > 0) {
      return t.Union(col.enumValues.map((val: string) => t.Literal(val)));
    }
    if (col.name === "slug") {
      return t.String({
        minLength: 2,
        maxLength: 100,
        pattern: "^[a-z0-9-]+$",
        description:
          "URL-friendly unique slug (lowercase letters, numbers, dashes)",
      });
    }
    return t.String();
  }

  return t.Any();
}

/**
 * Precomputes and freezes an immutable execution plan for a resource at registration or service.build().
 * Per-request execution paths do O(1) ID lookups against this plan.
 */
export function buildResourcePlan<TTable = any>(
  service: Service<any, any>,
  config: ResourceConfig<TTable, any>,
): ResourcePlan<TTable> {
  const resourceName = config.name;
  const pluralName = config.pluralName ?? `${resourceName}s`;
  const idField = config.idField ?? "id";
  const ownerField = config.ownerField;
  const table = config.table;
  const columns = getTableColumns(table as any);

  const columnMap = new Map<string, any>();
  for (const [key, col] of Object.entries(columns) as [string, any][]) {
    columnMap.set(key, col);
    if (col.name && col.name !== key) {
      columnMap.set(col.name, col);
    }
    if ((table as any)[key]) {
      columnMap.set(key, (table as any)[key]);
    }
  }

  const idCol =
    columnMap.get(idField) ?? (table as any)[idField] ?? (table as any).id;
  const ownerCol = ownerField ? columnMap.get(ownerField) : undefined;
  const ownerColName = ownerCol?.name ?? ownerField;

  const defaultColumns: Array<{ key: string; default: any }> = [];
  let createdAtKey: string | null = null;
  let updatedAtKey: string | null = null;

  for (const [key, col] of Object.entries(columns) as [string, any][]) {
    if (col.hasDefault && col.default !== undefined) {
      defaultColumns.push({ key, default: col.default });
    }
    const colName = col.name;
    if (colName === "created_at" || key === "createdAt") {
      createdAtKey = key;
    }
    if (colName === "updated_at" || key === "updatedAt") {
      updatedAtKey = key;
    }
  }

  const operations = config.operations ?? {};
  const listOpts = typeof operations.list === "object" ? operations.list : {};
  const searchFieldNames = config.searchable ??
    listOpts.searchable ?? ["title", "slug"];
  const searchCols = resolveSearchColumns(table, columns, searchFieldNames);

  const sortableArr = config.sortable ?? listOpts.sortable ?? [];
  const sortableFields = new Set<string>(sortableArr);
  const defaultSort =
    config.defaultSort ?? listOpts.defaultSort ?? "-updatedAt";
  const defaultSortEntries = parseSortEntries(defaultSort).filter((e) => {
    if (sortableFields.size > 0 && !sortableFields.has(e.field)) return false;
    return columnMap.has(e.field);
  });

  const fallbackField =
    (columnMap.has("updatedAt") && "updatedAt") ||
    (columnMap.has("updated_at") && "updated_at") ||
    (columnMap.has("createdAt") && "createdAt") ||
    (columnMap.has("created_at") && "created_at") ||
    null;
  const fallbackEntries: Array<{ field: string; dir: "asc" | "desc" }> =
    fallbackField != null ? [{ field: fallbackField, dir: "desc" }] : [];

  const defaultProjection = defaultListProjection(
    table,
    columns,
    config.excludeFromList,
  );

  const plan: ResourcePlan<TTable> = {
    resourceName,
    pluralName,
    table,
    idField,
    idCol,
    ownerField,
    ownerCol,
    ownerColName,
    columnMap,
    columns,
    defaultColumns: Object.freeze(defaultColumns),
    timestampColumns: Object.freeze({
      createdAtKey,
      updatedAtKey,
    }),
    searchable: Object.freeze({
      fields: searchFieldNames,
      columns: searchCols,
    }),
    sortable: Object.freeze({
      fields: sortableFields,
      defaultSort,
      defaultSortEntries: Object.freeze(defaultSortEntries),
      fallbackEntries: Object.freeze(fallbackEntries),
      tiebreakCol: idCol,
    }),
    projections: Object.freeze({
      defaultProjection,
    }),
    routeTargets: Object.freeze({
      listPath: `/${resourceName}`,
      itemPath: `/${resourceName}/:id`,
    }),
  };

  return Object.freeze(plan);
}

// Prepared Statement Cache per database instance
interface ResourceDbCache {
  writes?: ResourceWriteCache;
  getById?: any;
  deleteById?: any;
  listCache: Map<string, { select: any; count: any }>;
  defaultLists: Map<boolean, { select: any; count: any }>;
}

const dbCaches = new WeakMap<any, WeakMap<ResourcePlan, ResourceDbCache>>();

function getResourceDbCache(db: any, plan: ResourcePlan): ResourceDbCache {
  let resMap = dbCaches.get(db);
  if (!resMap) {
    resMap = new WeakMap();
    dbCaches.set(db, resMap);
  }
  let cache = resMap.get(plan);
  if (!cache) {
    cache = {
      listCache: new Map(),
      defaultLists: new Map(),
    };
    resMap.set(plan, cache);
  }
  return cache;
}

export interface ResourceReadQueries {
  readonly service: string;
  readonly resource: string;
  readonly get?: string;
  readonly list: string;
  readonly count: string;
  readonly ownerList?: string;
  readonly ownerCount?: string;
}

function defaultListOrder(plan: ResourcePlan) {
  const entries = plan.sortable.defaultSortEntries.length
    ? plan.sortable.defaultSortEntries
    : plan.sortable.fallbackEntries;
  const order = entries.map((entry) =>
    entry.dir === "desc"
      ? desc(plan.columnMap.get(entry.field))
      : asc(plan.columnMap.get(entry.field)),
  );
  const dir = entries[0]?.dir ?? "desc";
  if (
    plan.sortable.tiebreakCol &&
    plan.columnMap.get(entries[0]?.field ?? "") !== plan.sortable.tiebreakCol
  ) {
    order.push(
      dir === "desc"
        ? desc(plan.sortable.tiebreakCol)
        : asc(plan.sortable.tiebreakCol),
    );
  }
  return { entries, order };
}

function buildDefaultListQueries(db: any, plan: ResourcePlan, scoped: boolean) {
  const where = scoped
    ? eq(plan.ownerCol, sql.placeholder("__ownerId"))
    : undefined;
  const { order } = defaultListOrder(plan);
  let select = plan.projections.defaultProjection
    ? db.select(plan.projections.defaultProjection).from(plan.table)
    : db.select().from(plan.table);
  let count = db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(plan.table);
  if (where) {
    select = select.where(where);
    count = count.where(where);
  }
  if (order.length) select = select.orderBy(...order);
  select = select
    .limit(sql.placeholder("__limit"))
    .offset(sql.placeholder("__offset"));
  return { select, count };
}

/** SQL for inspection: query builders are constructed, not executed. */
export function describeResourceReads(
  service: Service<any, any>,
  resource: Resource<any, any>,
): ResourceReadQueries | undefined {
  const db = service.getDb() as any;
  const plan = resource.plan;
  if (!plan || typeof db?.select !== "function") return undefined;
  try {
    const global = buildDefaultListQueries(db, plan, false);
    const owner = plan.ownerCol
      ? buildDefaultListQueries(db, plan, true)
      : undefined;
    const get = plan.idCol
      ? db
          .select()
          .from(plan.table)
          .where(eq(plan.idCol, sql.placeholder("id")))
          .limit(1)
      : undefined;
    return {
      service: service.name,
      resource: resource.name,
      get: get?.toSQL().sql,
      list: global.select.toSQL().sql,
      count: global.count.toSQL().sql,
      ownerList: owner?.select.toSQL().sql,
      ownerCount: owner?.count.toSQL().sql,
    };
  } catch {
    return undefined;
  } // Unsupported adapters retain their existing execution path.
}

/** Prepare reusable queries once. Values and rows are never cached. */
export function prepareResourceReads(service: Service<any, any>): void {
  const db = service.getDb() as any;
  if (typeof db?.select !== "function") return;
  for (const resource of service.listResources()) {
    const plan = resource.plan;
    if (!plan) continue;
    const cache = getResourceDbCache(db, plan);
    if (plan.idCol && cache.getById === undefined) {
      try {
        cache.getById = db
          .select()
          .from(plan.table)
          .where(eq(plan.idCol, sql.placeholder("id")))
          .limit(1)
          .prepare();
      } catch {
        /* Leave lazy preparation/dynamic fallback available. */
      }
    }
    for (const scoped of plan.ownerCol ? [false, true] : [false]) {
      if (cache.defaultLists.has(scoped)) continue;
      try {
        const queries = buildDefaultListQueries(db, plan, scoped);
        const pair = {
          select: queries.select.prepare(),
          count: queries.count.prepare(),
        };
        cache.defaultLists.set(scoped, pair);
        cache.listCache.set(
          `|${scoped ? "1" : "0"}|${plan.sortable.defaultSort}|default`,
          pair,
        );
      } catch {
        /* Some adapters need a live schema; fall back without changing policy. */
      }
    }
  }
}

interface ResourceWriteCache {
  columns: [string, any][];
  inserts: Map<string, any>;
  updates: Map<string, any>;
  mainVersion: any;
  tempVersion: any;
  triggers: any;
  version?: string;
  hasTriggers: boolean;
}

/** Refresh on DDL, including TEMP triggers added after compilation. */
function refreshWriteSchema(writes: ResourceWriteCache): void {
  const version = `${writes.mainVersion.get().schema_version}:${writes.tempVersion.get().schema_version}`;
  if (writes.version === version) return;
  writes.hasTriggers = Boolean(writes.triggers.get());
  writes.inserts.clear();
  writes.updates.clear();
  writes.version = version;
}

/** A statement shape contains column keys, never values or evaluated JS defaults. */
function writeShape(
  writes: ResourceWriteCache,
  plan: ResourcePlan,
  operation: "insert" | "update",
  data: any,
) {
  const fields: number[] = [];
  const params: Record<string, any> = {};
  for (let index = 0; index < writes.columns.length; index++) {
    const [key, column] = writes.columns[index]!;
    if (operation === "insert" && column.shouldDisableInsert()) continue;
    // Drizzle evaluates update callbacks while building SQL, even for supplied values.
    if (operation === "update" && column.onUpdateFn !== undefined) return;
    const value = data[key];
    if (value === undefined) {
      // Drizzle evaluates these JS functions while building SQL. Never freeze their result.
      if (
        operation === "insert" &&
        column.default == null &&
        (column.defaultFn !== undefined || column.onUpdateFn !== undefined)
      )
        return;
      continue;
    }
    // Hooks may supply expressions or change the lookup key. Keep the existing readback behavior.
    if (
      is(value, SQL) ||
      is(value, Column) ||
      (column === plan.idCol && (operation === "update" || value === null))
    )
      return;
    fields.push(index);
    params[`__write_${index}`] = value;
  }
  if (!fields.length) return;
  return { fields, params };
}

function preparedWrite(
  db: any,
  plan: ResourcePlan,
  writes: ResourceWriteCache,
  operation: "insert" | "update",
  fields: number[],
) {
  const cache = operation === "insert" ? writes.inserts : writes.updates;
  const shape = fields.join(",");
  if (cache.has(shape)) return cache.get(shape);
  if (cache.size >= 64) return; // Bound the number of optional-field combinations.
  let statement: any;
  try {
    const values = Object.fromEntries(
      fields.map((index) => [
        writes.columns[index]![0],
        sql.placeholder(`__write_${index}`),
      ]),
    );
    let query =
      operation === "insert"
        ? db.insert(plan.table).values(values)
        : db
            .update(plan.table)
            .set(values)
            .where(eq(plan.idCol, sql.placeholder("__write_id")));
    // AFTER triggers may change returned values, even through another table's trigger.
    if (!writes.hasTriggers && (plan.idCol.primary || plan.idCol.isUnique))
      query = query.returning();
    statement = query.prepare();
  } catch {
    statement = null;
  } // Preparation has not executed any mutating SQL.
  cache.set(shape, statement);
  return statement;
}

/** Bun SQLite writes: prime common shapes; discover other shapes once and reuse them. */
export function prepareResourceWrites(service: Service<any, any>): void {
  const db = service.getDb() as any;
  // Other adapters keep their current write semantics until integration-tested.
  if (
    db?.constructor?.[entityKind] !== "BunSQLiteDatabase" ||
    !db.$client?.prepare
  )
    return;
  for (const resource of service.listResources()) {
    const plan = resource.plan;
    if (!plan?.idCol || !is(plan.table, SQLiteTable)) continue;
    const cache = getResourceDbCache(db, plan);
    if (cache.writes) continue;
    const columns = Object.entries(getTableColumns(plan.table));
    // Physical-name idField aliases retain the original dynamic lookup/readback semantics.
    if (
      !columns.some(
        ([key, column]) => key === plan.idField && column === plan.idCol,
      )
    )
      continue;
    try {
      const writes: ResourceWriteCache = {
        columns,
        inserts: new Map(),
        updates: new Map(),
        hasTriggers: true,
        mainVersion: db.$client.prepare("PRAGMA main.schema_version"),
        tempVersion: db.$client.prepare("PRAGMA temp.schema_version"),
        triggers: db.$client.prepare(
          "SELECT 1 FROM main.sqlite_schema WHERE type = 'trigger' UNION ALL SELECT 1 FROM temp.sqlite_schema WHERE type = 'trigger' LIMIT 1",
        ),
      };
      refreshWriteSchema(writes);
      cache.writes = writes;
      const prime = (operation: "insert" | "update", keys: string[]) => {
        const data = Object.fromEntries(keys.map((key) => [key, true]));
        const shape = writeShape(writes, plan, operation, data);
        if (shape) preparedWrite(db, plan, writes, operation, shape.fields);
      };
      if (resource.config.operations?.create !== false) {
        prime(
          "insert",
          columns
            .filter(([, col]: any) => !col.shouldDisableInsert())
            .map(([key]) => key),
        );
        prime(
          "insert",
          columns
            .filter(
              ([key, col]: any) =>
                key === plan.idField ||
                key === plan.ownerField ||
                key === plan.timestampColumns.createdAtKey ||
                key === plan.timestampColumns.updatedAtKey ||
                (col.notNull && !col.hasDefault) ||
                plan.defaultColumns.some((item) => item.key === key),
            )
            .map(([key]) => key),
        );
      }
      if (resource.config.operations?.update !== false) {
        const keys = columns
          .filter(([, col]) => col !== plan.idCol)
          .map(([key]) => key);
        prime("update", keys);
        const timestamp = plan.timestampColumns.updatedAtKey;
        if (timestamp) prime("update", [timestamp]);
        for (const key of keys)
          prime(
            "update",
            timestamp && timestamp !== key ? [key, timestamp] : [key],
          );
      }
    } catch {
      /* Unavailable SQLite metadata/schema keeps the dynamic path. */
    }
  }
}

function executePreparedWrite(
  db: any,
  plan: ResourcePlan,
  operation: "insert" | "update",
  data: any,
  id?: any,
  hookData = false,
): { row: any; readBack: boolean } | undefined {
  const writes = getResourceDbCache(db, plan).writes;
  if (!writes) return;
  if (
    hookData &&
    ((Object.getPrototypeOf(data) !== Object.prototype &&
      Object.getPrototypeOf(data) !== null) ||
      Object.values(Object.getOwnPropertyDescriptors(data)).some(
        (property) => property.get || property.set || !property.enumerable,
      ))
  )
    return;
  refreshWriteSchema(writes);
  const shape = writeShape(writes, plan, operation, data);
  if (!shape) return;
  const statement = preparedWrite(db, plan, writes, operation, shape.fields);
  if (!statement) return;
  const params = shape.params;
  params.__write_id = id;
  // Do not catch/replay execution errors: a write or its mapper may already have run.
  if (writes.hasTriggers || !(plan.idCol.primary || plan.idCol.isUnique)) {
    statement.run(params);
    return { row: undefined, readBack: true };
  }
  return { row: statement.get(params), readBack: false };
}

function formatListResult(
  plan: ResourcePlan,
  rows: any[],
  total: number,
  limit: number,
  offset: number,
  page: number,
  cursorActive: boolean,
  primarySort: { field: string; dir: "asc" | "desc" } | null,
  primaryCol: any,
  requestedSort: string,
) {
  const hasMore = cursorActive
    ? rows.length === limit
    : offset + rows.length < total;
  let nextCursor: string | null = null;
  if (
    hasMore &&
    rows.length &&
    primarySort &&
    primaryCol &&
    plan.sortable.tiebreakCol
  ) {
    const last = rows[rows.length - 1];
    const sortVal = rowValue(last, primarySort.field, primaryCol);
    const idVal = rowValue(last, plan.idField, plan.sortable.tiebreakCol);
    if (sortVal !== undefined && sortVal !== null)
      nextCursor = encodeCursor({
        v: [sortVal, idVal ?? null],
        s: requestedSort,
      });
  }
  const result = {
    items: rows,
    total,
    limit,
    offset: cursorActive ? 0 : offset,
    pageCount: Math.max(Math.ceil(total / limit), total > 0 ? 1 : 0),
    hasMore,
    nextCursor,
  };
  return cursorActive ? result : { ...result, page };
}

async function executeGet(
  db: any,
  plan: ResourcePlan,
  idVal: any,
): Promise<any> {
  if (typeof db?.select === "function" && plan.idCol) {
    const cache = getResourceDbCache(db, plan);
    if (cache.getById === undefined) {
      try {
        cache.getById = db
          .select()
          .from(plan.table)
          .where(eq(plan.idCol, sql.placeholder("id")))
          .limit(1)
          .prepare();
      } catch {
        cache.getById = null;
      }
    }

    if (cache.getById) {
      try {
        if (typeof cache.getById.get === "function") {
          return await cache.getById.get({ id: idVal });
        }
        const rows = await cache.getById.execute({ id: idVal });
        return rows[0];
      } catch {
        // Fallback to dynamic on error
      }
    }
  }

  // Fallback to dynamic Drizzle
  const [row] = await db
    .select()
    .from(plan.table)
    .where(eq(plan.idCol, idVal))
    .limit(1);
  return row;
}

async function executeDelete(
  db: any,
  plan: ResourcePlan,
  idVal: any,
): Promise<any> {
  if (typeof db?.delete === "function" && plan.idCol) {
    const cache = getResourceDbCache(db, plan);
    if (cache.deleteById === undefined) {
      try {
        cache.deleteById = db
          .delete(plan.table)
          .where(eq(plan.idCol, sql.placeholder("id")))
          .prepare();
      } catch {
        cache.deleteById = null;
      }
    }

    if (cache.deleteById) {
      try {
        return await cache.deleteById.execute({ id: idVal });
      } catch {
        // Fallback to dynamic on error
      }
    }
  }

  return await db.delete(plan.table).where(eq(plan.idCol, idVal));
}

export function defineResource<
  TTable = any,
  TCtx extends ActionContext = ActionContext,
  const TOptions extends ResourceTypeOptions = ResourceTypeOptions,
>(
  service: Service<any, any>,
  config: ResourceConfig<TTable, TCtx> & TOptions,
): Resource<TTable, TCtx, TOptions> {
  const resourceName = config.name;
  const capitalizedName =
    resourceName.charAt(0).toUpperCase() + resourceName.slice(1);
  const pluralName = config.pluralName ?? `${resourceName}s`;
  const idField = config.idField ?? "id";
  const ownerField = config.ownerField;
  const table = config.table;
  const columns = getTableColumns(table as any);
  const fieldsOverride = config.fields ?? {};

  // Build immutable execution plan
  const plan = buildResourcePlan(service, config);

  // Register table on service
  service.registerTable(table);

  // Derive TypeBox Schemas
  // 1. Row Schema (Full table row)
  const rowProperties: Record<string, TSchema> = {};
  for (const [key, col] of Object.entries(columns) as [string, any][]) {
    const baseType = columnToTypeBox(
      col,
      fieldsOverride[key] ?? fieldsOverride[col.name],
    );
    if (col.notNull) {
      rowProperties[key] = baseType;
    } else {
      rowProperties[key] = t.Optional(t.Union([baseType, t.Null()]));
    }
  }
  const rowSchema = t.Object(rowProperties);

  // 2. Create Input Schema
  // Excludes auto-generated fields: primary key (id), ownerField, createdAt, updatedAt
  const createProperties: Record<string, TSchema> = {};
  for (const [key, col] of Object.entries(columns) as [string, any][]) {
    const colName = col.name;
    const isId = col.primary || key === idField || colName === idField;
    const isOwner =
      ownerField && (key === ownerField || colName === ownerField);
    const isTimestamp =
      key === "createdAt" ||
      key === "updatedAt" ||
      colName === "created_at" ||
      colName === "updated_at";

    if (isId || isOwner || isTimestamp) {
      continue;
    }

    const baseType = columnToTypeBox(
      col,
      fieldsOverride[key] ?? fieldsOverride[colName],
    );
    if (col.hasDefault || !col.notNull) {
      createProperties[key] = t.Optional(baseType);
    } else {
      createProperties[key] = baseType;
    }
  }
  const createSchema = t.Object(createProperties);

  // 3. Update Input Schema
  // Requires ID; all other editable fields optional
  const updateProperties: Record<string, TSchema> = {
    [idField]: t.String(),
  };
  for (const [key, col] of Object.entries(columns) as [string, any][]) {
    const colName = col.name;
    const isId = col.primary || key === idField || colName === idField;
    const isOwner =
      ownerField && (key === ownerField || colName === ownerField);
    const isTimestamp =
      key === "createdAt" ||
      key === "updatedAt" ||
      colName === "created_at" ||
      colName === "updated_at";

    if (isId || isOwner || isTimestamp) {
      continue;
    }

    const baseType = columnToTypeBox(
      col,
      fieldsOverride[key] ?? fieldsOverride[colName],
    );
    updateProperties[key] = t.Optional(baseType);
  }
  const updateSchema = t.Object(updateProperties);

  // 4. Get Input Schema
  const getSchema = t.Object({
    [idField]: t.String(),
  });

  // 5. Delete Input Schema
  const deleteSchema = t.Object({
    [idField]: t.String(),
  });

  // 6. List Query Schema
  const operations = config.operations ?? {};
  const listOpts = typeof operations.list === "object" ? operations.list : {};
  const maxLimit = listOpts.maxLimit ?? 100;
  const listProperties: Record<string, TSchema> = {
    limit: t.Optional(t.Number({ minimum: 1, maximum: maxLimit })),
    offset: t.Optional(t.Number({ minimum: 0 })),
    page: t.Optional(t.Number({ minimum: 1 })),
    sort: t.Optional(t.String()),
    search: t.Optional(t.String()),
    select: t.Optional(t.Union([t.String(), t.Array(t.String())])),
    cursor: t.Optional(t.String()),
  };

  for (const [key, col] of Object.entries(columns) as [string, any][]) {
    const colName = col.name;
    const isTimestamp =
      key === "createdAt" ||
      key === "updatedAt" ||
      colName === "created_at" ||
      colName === "updated_at";
    if (isTimestamp) continue;

    const baseType = columnToTypeBox(
      col,
      fieldsOverride[key] ?? fieldsOverride[colName],
    );
    listProperties[key] = t.Optional(baseType);
  }
  const listSchema = t.Object(listProperties);

  // Action Implementations
  // 1. Create Action
  const createAction = defineAction({
    name: `${resourceName}.create`,
    description: `Create a new ${resourceName}`,
    input: createSchema,
    output: rowSchema,
    errors: {
      CONFLICT: { status: 409, message: "Resource already exists" },
      ...config.errors,
    },
    execute: async ({ input, ctx, error }) => {
      const db = ctx.db ?? service.getDb();
      const data: any = { ...input };

      // Auto-generate primary key if not provided
      if (!data[idField]) {
        if (config.idGenerator) {
          data[idField] = config.idGenerator();
        } else {
          const prefix =
            config.idPrefix ??
            (resourceName.toLowerCase() === "page"
              ? "pg"
              : resourceName.slice(0, 3));
          const rand = Math.random().toString(36).substring(2, 10);
          data[idField] = `${prefix}_${rand}`;
        }
      }

      // Populate column defaults from precomputed plan
      for (let i = 0; i < plan.defaultColumns.length; i++) {
        const item = plan.defaultColumns[i];
        if (data[item.key] === undefined) {
          data[item.key] = item.default;
        }
      }

      // Auto-generate timestamps from precomputed keys
      const now = new Date().toISOString();
      if (
        plan.timestampColumns.createdAtKey &&
        data[plan.timestampColumns.createdAtKey] === undefined
      ) {
        data[plan.timestampColumns.createdAtKey] = now;
      }
      if (
        plan.timestampColumns.updatedAtKey &&
        data[plan.timestampColumns.updatedAtKey] === undefined
      ) {
        data[plan.timestampColumns.updatedAtKey] = now;
      }

      // Ownership injection: inject ctx.user.id
      if (ownerField) {
        if (ctx.user?.id) {
          data[ownerField] = ctx.user.id;
        } else if (data[ownerField] === undefined) {
          data[ownerField] = null;
        }
      }

      // Hook: beforeCreate
      if (config.hooks?.beforeCreate) {
        await config.hooks.beforeCreate({
          data,
          ctx: ctx as TCtx,
          error: error as any,
        });
      }

      const written = executePreparedWrite(
        db,
        plan,
        "insert",
        data,
        undefined,
        Boolean(config.hooks?.beforeCreate),
      );
      if (!written) await db.insert(table).values(data);

      const idVal = data[idField];
      let createdRow: any = written?.row ?? data;
      if (plan.idCol && (!written || written.readBack)) {
        const row = await executeGet(db, plan, idVal);
        if (row) createdRow = row;
      }

      if (ctx.logger?.info) {
        const titleOrName =
          createdRow.title ?? createdRow.name ?? createdRow.slug ?? idVal;
        ctx.logger.info(
          `${capitalizedName} created: '${titleOrName}' (slug: /${createdRow.slug ?? idVal})`,
        );
      }

      // Hook: afterCreate
      if (config.hooks?.afterCreate) {
        await config.hooks.afterCreate({
          data,
          result: createdRow,
          ctx: ctx as TCtx,
        });
      }

      return createdRow;
    },
  });

  // 2. Get Action
  const getAction = defineAction({
    name: `${resourceName}.get`,
    description: `Retrieve a ${resourceName} by ID`,
    input: getSchema,
    output: rowSchema,
    errors: {
      NOT_FOUND: { status: 404, message: `${capitalizedName} not found` },
      FORBIDDEN: { status: 403, message: `Access denied to ${resourceName}` },
      ...config.errors,
    },
    execute: async ({ input, ctx, error }) => {
      const db = ctx.db ?? service.getDb();
      const idVal = input[idField] ?? input.id;

      if (!plan.idCol) {
        error.NOT_FOUND(`${capitalizedName} with ID '${idVal}' does not exist`);
      }

      const row = await executeGet(db, plan, idVal);
      if (!row) {
        error.NOT_FOUND(`${capitalizedName} with ID '${idVal}' does not exist`);
      }

      // Ownership verification
      if (ownerField && ctx.user?.id) {
        const rowOwner = row[ownerField] ?? row[plan.ownerColName!];
        if (rowOwner && rowOwner !== ctx.user.id) {
          error.FORBIDDEN(`Access denied to ${resourceName}`);
        }
      }

      return row;
    },
  });

  // 3. List Action
  const listItemProperties: Record<string, TSchema> = {};
  for (const [key, prop] of Object.entries(rowProperties)) {
    listItemProperties[key] = t.Optional(prop);
  }
  const listItemSchema = t.Object(listItemProperties);
  const listAction = defineAction({
    name: `${resourceName}.list`,
    description: `List ${pluralName}`,
    input: listSchema,
    output: t.Object({
      items: t.Array(listItemSchema),
      total: t.Number(),
      limit: t.Number(),
      offset: t.Number(),
      page: t.Optional(t.Number()),
      pageCount: t.Number(),
      hasMore: t.Boolean(),
      nextCursor: t.Union([t.String(), t.Null()]),
    }),
    errors: config.errors,
    execute: async ({ input = {}, ctx }) => {
      const db = ctx.db ?? service.getDb();
      const defaultLimit = listOpts.defaultLimit ?? 50;
      const maxLimitVal = listOpts.maxLimit ?? 100;
      const isPostgres =
        typeof (db as any)?.execute === "function" &&
        !(db as any)?.$client?.run;
      const isSQLite = !isPostgres;

      const raw = input as any;
      const limit =
        raw.limit !== undefined && raw.limit !== null
          ? Math.min(
              Math.max(Number(raw.limit) || defaultLimit, 1),
              maxLimitVal,
            )
          : defaultLimit;

      let offset =
        raw.offset !== undefined && raw.offset !== null
          ? Math.max(Number(raw.offset) || 0, 0)
          : 0;
      let page =
        raw.page !== undefined && raw.page !== null
          ? Math.max(Number(raw.page) || 1, 1)
          : Math.floor(offset / limit) + 1;
      if (raw.page !== undefined && raw.page !== null) {
        offset = (page - 1) * limit;
      } else {
        page = Math.floor(offset / limit) + 1;
      }

      // Standard pagination reuses compiler-prepared queries without rebuilding sort/filter SQL.
      const defaultLists =
        typeof db?.select === "function"
          ? getResourceDbCache(db, plan).defaultLists
          : undefined;
      const standardPagination =
        defaultLists?.size &&
        Object.entries(raw).every(
          ([key, value]) =>
            value === undefined ||
            value === null ||
            key === "limit" ||
            key === "offset" ||
            key === "page",
        );
      if (standardPagination) {
        const scoped = Boolean(ownerField && ctx.user?.id && plan.ownerCol);
        const pair = defaultLists!.get(scoped);
        if (pair) {
          try {
            const params = {
              __limit: limit,
              __offset: offset,
              ...(scoped ? { __ownerId: ctx.user.id } : {}),
            };
            const count = await pair.count.execute(params);
            const rows = await pair.select.execute(params);
            const entries = plan.sortable.defaultSortEntries.length
              ? plan.sortable.defaultSortEntries
              : plan.sortable.fallbackEntries;
            const primary = entries[0] ?? null;
            return formatListResult(
              plan,
              rows,
              count[0]?.n ?? 0,
              limit,
              offset,
              page,
              false,
              primary,
              primary ? plan.columnMap.get(primary.field) : null,
              plan.sortable.defaultSort,
            );
          } catch {
            /* Retain the established query fallback on execution failure. */
          }
        }
      }

      // Fast sort resolution using precomputed plan
      const requestedSort =
        typeof raw.sort === "string" && raw.sort.trim()
          ? raw.sort
          : plan.sortable.defaultSort;

      let sortEntries: Array<{ field: string; dir: "asc" | "desc" }>;
      if (requestedSort === plan.sortable.defaultSort) {
        sortEntries = plan.sortable.defaultSortEntries as any;
      } else {
        sortEntries = parseSortEntries(requestedSort).filter((e) => {
          if (
            plan.sortable.fields.size > 0 &&
            !plan.sortable.fields.has(e.field)
          )
            return false;
          return plan.columnMap.has(e.field);
        });
      }

      if (sortEntries.length === 0) {
        sortEntries = plan.sortable.fallbackEntries as any;
      }

      const orderBys = sortEntries.map((e) => {
        const col = plan.columnMap.get(e.field);
        return e.dir === "desc" ? desc(col) : asc(col);
      });

      const idColForSort = plan.sortable.tiebreakCol;
      const primaryDir = sortEntries.length > 0 ? sortEntries[0].dir : "desc";
      if (idColForSort) {
        const already =
          sortEntries.length > 0 &&
          plan.columnMap.get(sortEntries[0].field) === idColForSort;
        if (!already) {
          orderBys.push(
            primaryDir === "desc" ? desc(idColForSort) : asc(idColForSort),
          );
        }
      }
      const primarySort = sortEntries.length > 0 ? sortEntries[0] : null;
      const primaryCol = primarySort
        ? plan.columnMap.get(primarySort.field)
        : null;

      const conditions: any[] = [];
      const exactFilters: Array<{ key: string; col: any; val: any }> = [];

      // Ownership scoping: WHERE ownerField = ctx.user.id
      const isOwnerScoped = Boolean(
        ownerField && ctx.user?.id && plan.ownerCol,
      );
      if (isOwnerScoped) {
        conditions.push(eq(plan.ownerCol, ctx.user.id));
      }

      // Exact-match filters (O(1) ID lookups on precomputed columnMap)
      for (const [key, val] of Object.entries(raw)) {
        if (RESERVED_LIST_KEYS.has(key)) continue;
        if (val === undefined || val === null) continue;
        const col = plan.columnMap.get(key);
        if (col) {
          conditions.push(eq(col, val));
          exactFilters.push({ key, col, val });
        }
      }

      // Search (?search=)
      const searchTerm =
        typeof raw.search === "string" ? raw.search.trim() : "";
      if (searchTerm) {
        let pushed = false;
        if (isSQLite) {
          try {
            const ftsQuery = buildFtsMatchQuery(searchTerm);
            if (ftsQuery && plan.idCol) {
              const tableName = getTableName(table as any);
              const fts = `${tableName}_fts`;
              conditions.push(
                sql`${plan.idCol} IN (SELECT "id" FROM ${sql.raw(`"${fts.replace(/"/g, '""')}"`)} WHERE ${sql.raw(`"${fts.replace(/"/g, '""')}"`)} MATCH ${ftsQuery})`,
              );
              pushed = true;
            }
          } catch {
            pushed = false;
          }
        }
        if (!pushed) {
          const searchCols = plan.searchable.columns;
          if (searchCols.length > 0) {
            const ors = searchCols.map((col) =>
              isPostgres
                ? ilike(col as any, `%${searchTerm}%`)
                : like(sql`lower(${col})`, `%${searchTerm.toLowerCase()}%`),
            );
            conditions.push(ors.length === 1 ? ors[0] : or(...ors));
          }
        }
      }

      // Keyset cursor (?cursor=)
      let cursorActive = false;
      const cursorRaw = typeof raw.cursor === "string" ? raw.cursor : "";
      if (cursorRaw && primarySort && primaryCol && idColForSort) {
        const decoded = decodeCursor<{
          v?: any[];
          s?: string;
        }>(cursorRaw);
        if (
          decoded &&
          Array.isArray(decoded.v) &&
          decoded.v.length >= 1 &&
          (decoded.s === undefined || decoded.s === requestedSort)
        ) {
          const [sortVal, idVal] = decoded.v;
          if (sortVal !== undefined && sortVal !== null) {
            const cmp = primarySort.dir === "desc" ? lt : gt;
            const cmpOrEq = primarySort.dir === "desc" ? lte : gte;
            const tie =
              idVal !== undefined && idVal !== null
                ? or(
                    cmp(primaryCol, sortVal),
                    and(cmpOrEq(primaryCol, sortVal), cmp(idColForSort, idVal)),
                  )
                : cmp(primaryCol, sortVal);
            conditions.push(tie);
            cursorActive = true;
            offset = 0;
          }
        }
      }

      // Column projection: explicit ?select= wins; else precomputed default projection
      const explicitProj = raw.select
        ? parseSelectParam(table, columns, raw.select)
        : undefined;
      const projection = explicitProj ?? plan.projections.defaultProjection;

      let total: number;
      let rows: any[];

      // Prepared query caching fast path for standard list queries
      const canPrepare =
        !cursorActive && !searchTerm && typeof db?.select === "function";

      let usedPrepared = false;
      if (canPrepare) {
        const cache = getResourceDbCache(db, plan);
        const filterKey = exactFilters
          .map((f) => f.key)
          .sort()
          .join(",");
        const sortKey = requestedSort;
        const projKey = raw.select ? String(raw.select) : "default";
        const shapeKey = `${filterKey}|${isOwnerScoped ? "1" : "0"}|${sortKey}|${projKey}`;

        let preparedPair = cache.listCache.get(shapeKey);
        if (!preparedPair) {
          try {
            const prepWhereParts: any[] = [];
            if (isOwnerScoped) {
              prepWhereParts.push(
                eq(plan.ownerCol, sql.placeholder("__ownerId")),
              );
            }
            for (let i = 0; i < exactFilters.length; i++) {
              prepWhereParts.push(
                eq(
                  exactFilters[i].col,
                  sql.placeholder(`__f_${exactFilters[i].key}`),
                ),
              );
            }
            const prepWhere =
              prepWhereParts.length === 1
                ? prepWhereParts[0]
                : prepWhereParts.length > 1
                  ? and(...prepWhereParts)
                  : undefined;

            let sQuery = projection
              ? db.select(projection).from(table)
              : db.select().from(table);
            if (prepWhere) sQuery = sQuery.where(prepWhere);
            if (orderBys.length > 0) sQuery = sQuery.orderBy(...orderBys);
            sQuery = sQuery
              .limit(sql.placeholder("__limit"))
              .offset(sql.placeholder("__offset"));
            const preparedSelect = sQuery.prepare();

            let cQuery = db
              .select({ n: sql<number>`count(*)`.mapWith(Number) })
              .from(table);
            if (prepWhere) cQuery = cQuery.where(prepWhere);
            const preparedCount = cQuery.prepare();

            preparedPair = { select: preparedSelect, count: preparedCount };
            if (cache.listCache.size < 64) {
              cache.listCache.set(shapeKey, preparedPair);
            }
          } catch {
            preparedPair = undefined;
          }
        }

        if (preparedPair) {
          try {
            const execParams: Record<string, any> = {
              __limit: limit,
              __offset: offset,
            };
            if (isOwnerScoped) {
              execParams.__ownerId = ctx.user.id;
            }
            for (let i = 0; i < exactFilters.length; i++) {
              execParams[`__f_${exactFilters[i].key}`] = exactFilters[i].val;
            }

            const countRes = await preparedPair.count.execute(execParams);
            total = countRes[0]?.n ?? 0;
            rows = await preparedPair.select.execute(execParams);
            usedPrepared = true;
          } catch {
            usedPrepared = false;
          }
        }
      }

      if (!usedPrepared) {
        const where = conditions.length > 0 ? and(...conditions) : undefined;

        // Total via SQL COUNT(*) with identical WHERE
        const countQuery = (db as any)
          .select({ n: sql<number>`count(*)`.mapWith(Number) })
          .from(table);
        const [{ n: totalCount } = { n: 0 }] = await (where
          ? countQuery.where(where)
          : countQuery);
        total = totalCount;

        // Paginated data query
        const baseSelect = projection
          ? (db as any).select(projection).from(table)
          : (db as any).select().from(table);
        const filtered =
          where !== undefined ? baseSelect.where(where) : baseSelect;
        const ordered =
          orderBys.length > 0 ? filtered.orderBy(...orderBys) : filtered;
        rows = await ordered.limit(limit).offset(cursorActive ? 0 : offset);
      }

      return formatListResult(
        plan,
        rows!,
        total!,
        limit,
        offset,
        page,
        cursorActive,
        primarySort,
        primaryCol,
        requestedSort,
      );
    },
  });

  // 4. Update Action
  const updateAction = defineAction({
    name: `${resourceName}.update`,
    description: `Update a ${resourceName} by ID`,
    input: updateSchema,
    output: rowSchema,
    errors: {
      NOT_FOUND: { status: 404, message: `${capitalizedName} not found` },
      FORBIDDEN: {
        status: 403,
        message: `Access denied to update ${resourceName}`,
      },
      ...config.errors,
    },
    execute: async ({ input, ctx, error }) => {
      const db = ctx.db ?? service.getDb();
      const idVal = input[idField] ?? input.id;

      if (!plan.idCol) {
        error.NOT_FOUND(`${capitalizedName} with ID '${idVal}' not found`);
      }

      const existing = await executeGet(db, plan, idVal);
      if (!existing) {
        error.NOT_FOUND(`${capitalizedName} with ID '${idVal}' not found`);
      }

      // Ownership verification
      if (ownerField && ctx.user?.id) {
        const rowOwner = existing[ownerField] ?? existing[plan.ownerColName!];
        if (rowOwner && rowOwner !== ctx.user.id) {
          error.FORBIDDEN(`Access denied to update ${resourceName}`);
        }
      }

      const {
        id: _ignoreId,
        [idField]: _ignoreIdField,
        ...updateData
      }: any = input;

      // Update timestamp using precomputed key
      if (plan.timestampColumns.updatedAtKey) {
        updateData[plan.timestampColumns.updatedAtKey] =
          new Date().toISOString();
      }

      // Hook: beforeUpdate
      if (config.hooks?.beforeUpdate) {
        await config.hooks.beforeUpdate({
          id: idVal as string | number,
          data: updateData,
          existing,
          ctx: ctx as TCtx,
          error: error as any,
        });
      }

      let written: ReturnType<typeof executePreparedWrite>;
      if (Object.keys(updateData).length > 0) {
        written = executePreparedWrite(
          db,
          plan,
          "update",
          updateData,
          idVal,
          Boolean(config.hooks?.beforeUpdate),
        );
        if (!written)
          await db.update(table).set(updateData).where(eq(plan.idCol, idVal));
      }

      const updated =
        written && !written.readBack
          ? written.row
          : await executeGet(db, plan, idVal);

      // Hook: afterUpdate
      if (config.hooks?.afterUpdate) {
        await config.hooks.afterUpdate({
          id: idVal as string | number,
          data: updateData,
          result: updated ?? existing,
          ctx: ctx as TCtx,
        });
      }

      return updated ?? existing;
    },
  });

  // 5. Delete Action
  const deleteAction = defineAction({
    name: `${resourceName}.delete`,
    description: `Delete a ${resourceName} by ID`,
    input: deleteSchema,
    output: t.Object({
      success: t.Boolean(),
      id: t.Union([t.String(), t.Number()]),
    }),
    errors: {
      NOT_FOUND: { status: 404, message: `${capitalizedName} not found` },
      FORBIDDEN: {
        status: 403,
        message: `Access denied to delete ${resourceName}`,
      },
      ...config.errors,
    },
    execute: async ({ input, ctx, error }) => {
      const db = ctx.db ?? service.getDb();
      const idVal = input[idField] ?? input.id;

      if (!plan.idCol) {
        error.NOT_FOUND(`${capitalizedName} with ID '${idVal}' not found`);
      }

      const existing = await executeGet(db, plan, idVal);
      if (!existing) {
        error.NOT_FOUND(`${capitalizedName} with ID '${idVal}' not found`);
      }

      // Ownership verification
      if (ownerField && ctx.user?.id) {
        const rowOwner = existing[ownerField] ?? existing[plan.ownerColName!];
        if (rowOwner && rowOwner !== ctx.user.id) {
          error.FORBIDDEN(`Access denied to delete ${resourceName}`);
        }
      }

      // Hook: beforeDelete
      if (config.hooks?.beforeDelete) {
        await config.hooks.beforeDelete({
          id: idVal as string | number,
          existing,
          ctx: ctx as TCtx,
          error: error as any,
        });
      }

      await executeDelete(db, plan, idVal);

      // Hook: afterDelete
      if (config.hooks?.afterDelete) {
        await config.hooks.afterDelete({
          id: idVal as string | number,
          existing,
          ctx: ctx as TCtx,
          error: error as any,
        });
      }

      return { success: true, id: idVal as string | number };
    },
  });

  // Attach actions to service
  if (operations.create !== false) {
    service.action(createAction);
    service.actions.set(`create${capitalizedName}`, createAction);
  }
  if (operations.get !== false) {
    service.action(getAction);
    service.actions.set(`get${capitalizedName}`, getAction);
  }
  if (operations.list !== false) {
    service.action(listAction);
    service.actions.set(
      `list${pluralName.charAt(0).toUpperCase() + pluralName.slice(1)}`,
      listAction,
    );
  }
  if (operations.update !== false) {
    service.action(updateAction);
    service.actions.set(`update${capitalizedName}`, updateAction);
  }
  if (operations.delete !== false) {
    service.action(deleteAction);
    service.actions.set(`delete${capitalizedName}`, deleteAction);
  }

  // Runtime schemas are assembled from columns above; expose those same
  // columns and configuration as static action schemas at this boundary.
  const actions = {
    list: listAction,
    get: getAction,
    create: createAction,
    update: updateAction,
    delete: deleteAction,
  } as unknown as Resource<TTable, TCtx, TOptions>["actions"];
  const resource: Resource<TTable, TCtx, TOptions> = {
    name: resourceName,
    serviceName: service.name,
    table,
    ownerField,
    idField,
    pluralName,
    config,
    plan,
    actions,
    ...actions,
  };

  return resource;
}
