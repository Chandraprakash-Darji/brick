import { defineResourcePlugin, t, ActionExecutionError } from "@brickkit/core";
import { Type, FormatRegistry, Kind, type TSchema } from "@sinclair/typebox";
import {
  getTableColumns,
  type Column,
  type SQL,
  and,
  or,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  inArray,
  notInArray,
  between,
  isNull,
  isNotNull,
  asc,
  desc,
  sql,
} from "drizzle-orm";
import type {
  CrudOptions,
  CrudPlugin,
  Fields,
  Operations,
  Operation,
  FilterOperator,
} from "./types";
export type * from "./types";

const methods: Record<
  Operation,
  { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string }
> = {
  list: { method: "POST", path: "/query" },
  get: { method: "GET", path: "/:id" },
  create: { method: "POST", path: "/" },
  update: { method: "PATCH", path: "/:id" },
  delete: { method: "DELETE", path: "/:id" },
  findOne: { method: "POST", path: "/find-one" },
  count: { method: "POST", path: "/count" },
  exists: { method: "POST", path: "/exists" },
};
const isoPattern =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$";
if (!FormatRegistry.Has("date-time"))
  FormatRegistry.Set(
    "date-time",
    (value) =>
      new RegExp(isoPattern).test(value) && Number.isFinite(Date.parse(value)),
  );
function jsonValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item)]),
    );
  return value;
}
function databaseValue(column: Column, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (column.dataType === "date" && typeof value === "string")
    return new Date(value);
  if (column.dataType === "bigint" && typeof value === "string")
    return BigInt(value);
  return value;
}
function checkJsonSchema(schema: TSchema, seen = new Set<object>()): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  if (
    [
      "Date",
      "BigInt",
      "Undefined",
      "Symbol",
      "Function",
      "Constructor",
      "Void",
    ].includes(schema[Kind])
  )
    throw new Error(
      `CRUD schema '${schema[Kind]}' is not JSON-safe; use string date-time or decimal strings`,
    );
  for (const value of Object.values(schema)) {
    if (Array.isArray(value)) {
      for (const child of value)
        if (child && typeof child === "object")
          checkJsonSchema(child as TSchema, seen);
    } else if (value && typeof value === "object")
      checkJsonSchema(value as TSchema, seen);
  }
}
function columnSchema(column: Column): TSchema {
  const c = column as Column & { enumValues?: string[] };
  let schema: TSchema;
  if (c.enumValues?.length)
    schema = t.Union(c.enumValues.map((v) => t.Literal(v)));
  else
    switch (c.dataType) {
      case "string":
        schema = t.String();
        break;
      case "number":
        schema = t.Number();
        break;
      case "boolean":
        schema = t.Boolean();
        break;
      case "date":
        schema = t.String({ format: "date-time", pattern: isoPattern });
        break;
      case "bigint":
        schema = t.String({ pattern: "^-?(?:0|[1-9][0-9]*)$" });
        break;
      case "json":
        schema = t.Unknown();
        break;
      case "array":
        schema = t.Array(t.Unknown());
        break;
      default:
        schema = t.Unknown();
    }
  return c.notNull ? schema : t.Union([schema, t.Null()]);
}
function object(properties: Record<string, TSchema>) {
  return t.Object(properties, { additionalProperties: false });
}
const invalid = (message: string): never => {
  throw new ActionExecutionError("BAD_REQUEST", message, 400);
};
const MAX_WHERE_DEPTH = 20;
// Iterative pre-validation depth walk over raw `where` input. The action
// input validator runs before execute()/condition(), so unbounded `and`/`or`
// nesting would recurse inside the compiled TypeBox check first — past the
// call-stack limit it throws RangeError (HTTP 500) instead of a 400. This
// keeps rejection O(nesting) with constant stack on every entry path.
function whereDepthExceeded(input: unknown): boolean {
  const root =
    input && typeof input === "object"
      ? (input as { where?: unknown }).where
      : undefined;
  if (!root || typeof root !== "object") return false;
  const stack: { node: unknown; depth: number }[] = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > MAX_WHERE_DEPTH) return true;
    const record = node as Record<string, unknown>;
    for (const key of ["and", "or"] as const) {
      const children = record[key];
      if (Array.isArray(children))
        for (const child of children)
          stack.push({ node: child, depth: depth + 1 });
    }
  }
  return false;
}
const own = (value: object, key: string) => Object.hasOwn(value, key);
function uniqueViolation(error: unknown): boolean {
  let current = error;
  for (
    let depth = 0;
    depth < 5 && current && typeof current === "object";
    depth++
  ) {
    if (
      "code" in current &&
      [
        "23505",
        "SQLITE_CONSTRAINT_UNIQUE",
        "SQLITE_CONSTRAINT_PRIMARYKEY",
      ].includes(String(current.code))
    )
      return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

export function crud<const F extends Fields, const O extends Operations = {}>(
  options: CrudOptions<F, O>,
): CrudPlugin<F, O> {
  options = {
    ...options,
    fields: Object.fromEntries(
      Object.entries(options.fields).map(([key, value]) => [
        key,
        { ...value, filter: value.filter ? [...value.filter] : undefined },
      ]),
    ) as F,
    access: options.access ? { ...options.access } : undefined,
    hooks: options.hooks ? { ...options.hooks } : undefined,
    operations:
      typeof options.operations === "object"
        ? { ...options.operations }
        : options.operations,
  };
  const descriptor = defineResourcePlugin({
    name: "@brickkit/crud",
    routes: options.routes,
    setup({ resource, service, routes }) {
      if (options.operations === false) return {};
      const columns: Record<string, Column> = getTableColumns(resource.table);
      const fields: Fields = Object.fromEntries(
        Object.entries(options.fields).map(([key, value]) => [
          key,
          { ...value, filter: value.filter ? [...value.filter] : undefined },
        ]),
      );
      const schemas: Record<string, TSchema> = {};
      const readable = Object.keys(fields).filter((key) => fields[key].read);
      const projection: Record<string, Column> = {};
      for (const [key, policy] of Object.entries(fields)) {
        if (!own(columns, key))
          throw new Error(`Unknown CRUD field '${key}' on '${resource.name}'`);
        schemas[key] = policy.schema ?? columnSchema(columns[key]);
        checkJsonSchema(schemas[key]);
        if (columns[key] === resource.id && policy.update)
          throw new Error("CRUD primary key cannot be updated");
        for (const operator of policy.filter ?? []) {
          if (
            ![
              "eq",
              "ne",
              "in",
              "notIn",
              "gt",
              "gte",
              "lt",
              "lte",
              "between",
              "contains",
              "startsWith",
              "endsWith",
              "isNull",
              "isNotNull",
            ].includes(operator)
          )
            throw new Error(`Unknown filter operator '${operator}'`);
          if (
            ["contains", "startsWith", "endsWith"].includes(operator) &&
            columns[key].dataType !== "string"
          )
            throw new Error(
              `Text filter '${operator}' requires a string column '${key}'`,
            );
        }
        for (const operator of policy.filter ?? []) {
          if (
            ["gt", "gte", "lt", "lte", "between"].includes(operator) &&
            !["string", "number", "date", "bigint"].includes(
              columns[key].dataType,
            )
          )
            throw new Error(
              `Ordered filter '${operator}' is unsupported for '${key}'`,
            );
          if (
            !["isNull", "isNotNull"].includes(operator) &&
            ["json", "array", "buffer", "custom"].includes(
              columns[key].dataType,
            )
          )
            throw new Error(`Filter '${operator}' is unsupported for '${key}'`);
        }
        if (
          policy.sort &&
          !["string", "number", "date", "bigint", "boolean"].includes(
            columns[key].dataType,
          )
        )
          throw new Error(`Sorting is unsupported for '${key}'`);
        if (policy.read) projection[key] = columns[key];
      }
      const idColumn: Column = resource.id;
      if (!Object.values(columns).includes(idColumn))
        throw new Error("CRUD ID must belong to the resource table");
      const idSchema = columnSchema(idColumn);
      const defaultLimit = options.defaultLimit ?? 20;
      const maxLimit = options.maxLimit ?? 100;
      if (
        !Number.isInteger(defaultLimit) ||
        defaultLimit < 1 ||
        !Number.isInteger(maxLimit) ||
        maxLimit < defaultLimit
      )
        throw new Error("Invalid CRUD pagination limits");
      const fieldLiteral = (keys: string[]) =>
        keys.length ? t.Union(keys.map((key) => t.Literal(key))) : t.Never();
      // Named where leaves: one union schema per filterable field plus named
      // `and`/`or` branches. The client-contract generator only emits aliases
      // for schemas reached via $ref (using `title ?? $id`), so anonymous
      // leaves degrade to hash names. Each field union is imported by $ref
      // from a module: TypeBox hoists every $id subschema into a shared
      // check function, so compilation stays linear. Union nesting is
      // associative, so validation accepts exactly the same inputs.
      const whereId = `CrudWhere:${resource.name}`;
      const whereTitle = (suffix: string) => `Where:${resource.name}:${suffix}`;
      const whereFields: Record<string, TSchema> = {};
      for (const [field, policy] of Object.entries(fields)) {
        const operators = policy.filter ?? [];
        if (!operators.length) continue;
        if (field === "and" || field === "or")
          throw new Error(
            `CRUD filter field '${field}' on '${resource.name}' collides with the '${field}' branch`,
          );
        const fieldLeaves = operators.map((op) => {
          const valueSchema = Type.Exclude(schemas[field], t.Null());
          const value: Record<string, TSchema> = [
            "isNull",
            "isNotNull",
          ].includes(op)
            ? {}
            : {
                value: ["in", "notIn"].includes(op)
                  ? t.Array(valueSchema, { minItems: 1, maxItems: 1000 })
                  : op === "between"
                    ? t.Tuple([valueSchema, valueSchema])
                    : valueSchema,
              };
          return object({
            field: t.Literal(field),
            op: t.Literal(op),
            ...value,
          });
        });
        whereFields[`${whereId}:${field}`] = t.Union(fieldLeaves, {
          title: whereTitle(field),
        });
      }
      const whereModule = t.Module({
        ...whereFields,
        [`${whereId}:and`]: t.Object(
          { and: t.Array(t.Ref(whereId), { minItems: 1, maxItems: 50 }) },
          { additionalProperties: false, title: whereTitle("and") },
        ),
        [`${whereId}:or`]: t.Object(
          { or: t.Array(t.Ref(whereId), { minItems: 1, maxItems: 50 }) },
          { additionalProperties: false, title: whereTitle("or") },
        ),
      });
      // Recursive rather than depth-inlined: TypeCompiler expands shared
      // inlined subschemas exponentially, stalling first validation for
      // seconds. Each $id member above compiles to one shared function, so
      // the recursion through the module $refs stays linear. Runtime
      // `condition()` still rejects nesting beyond 20, and the
      // `validateInput` wrapper below rejects it before validation runs.
      // The Recursive callback ignores Self on purpose: recursion flows
      // through the named module $refs back to this root $id.
      const whereSchema: TSchema =
        Object.keys(whereFields).length > 0
          ? t.Recursive(
              () =>
                t.Union([
                  ...Object.keys(whereFields).map((id) =>
                    whereModule.Import(id),
                  ),
                  whereModule.Import(`${whereId}:and`),
                  whereModule.Import(`${whereId}:or`),
                ]),
              { $id: whereId },
            )
          : t.Never();
      const selection = t.Optional(
        t.Array(fieldLiteral(readable), { minItems: 1, uniqueItems: true }),
      );
      const queryProperties = {
        select: selection,
        where: t.Optional(whereSchema),
        orderBy: t.Optional(
          t.Array(
            object({
              field: fieldLiteral(
                Object.keys(fields).filter((key) => fields[key].sort),
              ),
              direction: t.Union([t.Literal("asc"), t.Literal("desc")]),
            }),
            { maxItems: 20 },
          ),
        ),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: maxLimit })),
        offset: t.Optional(t.Integer({ minimum: 0 })),
        includeTotal: t.Optional(t.Boolean()),
      };
      const querySchema = object(queryProperties);
      const rowFields = Object.fromEntries(
        readable.map((key) => [
          key,
          fields[key].scrub ? t.Unknown() : schemas[key],
        ]),
      );
      // Strict contract row: every readable field is required. Nullable
      // columns already carry `| null` via columnSchema, so they stay
      // `T | null` — never `| undefined`. This is what ships in
      // `config.output` for the browser contract and OpenAPI.
      const rowSchema = object({ ...rowFields });
      // Runtime validation must still accept subset projections (`select`),
      // which return only the requested keys. The loose variant permits
      // omission; it is wired via `outputValidationSchema` below and never
      // leaks into generated types.
      const rowSchemaLoose = object(
        Object.fromEntries(
          Object.entries(rowFields).map(([key, schema]) => [
            key,
            t.Optional(schema),
          ]),
        ),
      );
      const writeSchema = (kind: "create" | "update") =>
        object(
          Object.fromEntries(
            Object.entries(fields)
              .filter(([, p]) => p[kind])
              .map(([key]) => [
                key,
                kind === "update" ||
                columns[key].hasDefault ||
                !columns[key].notNull
                  ? t.Optional(schemas[key])
                  : schemas[key],
              ]),
          ),
        );
      const createSchema = writeSchema("create");
      const updateSchema = writeSchema("update");
      const inputs: Record<Operation, TSchema> = {
        list: querySchema,
        findOne: querySchema,
        get: object({ id: idSchema, select: selection }),
        create: createSchema,
        update: object({ id: idSchema, data: updateSchema }),
        delete: object({ id: idSchema }),
        count: object({ where: t.Optional(whereSchema) }),
        exists: object({ where: t.Optional(whereSchema) }),
      };
      const outputs: Record<Operation, TSchema> = {
        list: object({
          items: t.Array(rowSchema),
          total: t.Optional(t.Integer()),
          limit: t.Integer(),
          offset: t.Integer(),
        }),
        findOne: t.Union([rowSchema, t.Null()]),
        get: rowSchema,
        create: rowSchema,
        update: rowSchema,
        delete: object({ success: t.Literal(true) }),
        count: object({ count: t.Integer() }),
        exists: object({ exists: t.Boolean() }),
      };
      // Runtime-only outputs: same shape but rows may be subset projections.
      const looseOutputs: Record<Operation, TSchema> = {
        list: object({
          items: t.Array(rowSchemaLoose),
          total: t.Optional(t.Integer()),
          limit: t.Integer(),
          offset: t.Integer(),
        }),
        findOne: t.Union([rowSchemaLoose, t.Null()]),
        get: rowSchemaLoose,
        create: rowSchemaLoose,
        update: rowSchemaLoose,
        delete: object({ success: t.Literal(true) }),
        count: object({ count: t.Integer() }),
        exists: object({ exists: t.Boolean() }),
      };
      const prepared = new WeakMap<object, Map<string, any>>();
      const executeQuery = async (
        db: any,
        key: string,
        build: () => any,
        params: Record<string, unknown>,
        cacheable: boolean,
      ) => {
        if (cacheable && db.$client?.prepare) {
          let cache = prepared.get(db);
          if (!cache) {
            cache = new Map();
            prepared.set(db, cache);
          }
          let statement = cache.get(key);
          if (!statement) {
            statement = build().prepare();
            if (cache.size >= 128) cache.delete(cache.keys().next().value!);
            cache.set(key, statement);
          }
          return statement.execute(params);
        }
        return await build();
      };
      const api: Record<string, unknown> = {};
      for (const operation of Object.keys(methods) as Operation[]) {
        if (options.operations && options.operations[operation] === false)
          continue;
        const action = routes.action({
          name: operation,
          ...methods[operation],
          input: inputs[operation],
          output: outputs[operation],
          execute: async ({ input: validatedInput, ctx, error }) => {
            const input: any = validatedInput;
            if (
              options.access?.authorize &&
              !(await options.access.authorize({ operation, input, ctx }))
            )
              throw new ActionExecutionError("FORBIDDEN", "Access denied", 403);
            const db: any = ctx.db ?? service.getDb();
            if (!db) throw new Error("CRUD requires a configured database");
            const scope = await options.access?.scope?.({ operation, ctx });
            const cacheable =
              !scope &&
              !!db.$client?.prepare &&
              !Object.values(columns).some(
                (column) => column.defaultFn || column.onUpdateFn,
              );
            const params: Record<string, unknown> = {};
            let parameter = 0;
            const bind = (value: unknown): any => {
              if (!cacheable) return value;
              const key = `p${parameter++}`;
              params[key] = value;
              return sql.placeholder(key);
            };
            const shape: unknown[] = [];
            const condition = (node: any, depth = 0): SQL => {
              if (depth > MAX_WHERE_DEPTH)
                invalid(`Filter nesting exceeds ${MAX_WHERE_DEPTH} levels`);
              if (node.and) {
                shape.push("and", node.and.length);
                return and(
                  ...node.and.map((n: any) => condition(n, depth + 1)),
                )!;
              }
              if (node.or) {
                shape.push("or", node.or.length);
                return or(...node.or.map((n: any) => condition(n, depth + 1)))!;
              }
              const col = columns[node.field];
              shape.push(node.field, node.op);
              switch (node.op as FilterOperator) {
                case "eq":
                  return eq(col, bind(databaseValue(col, node.value)));
                case "ne":
                  return ne(col, bind(databaseValue(col, node.value)));
                case "gt":
                  return gt(col, bind(databaseValue(col, node.value)));
                case "gte":
                  return gte(col, bind(databaseValue(col, node.value)));
                case "lt":
                  return lt(col, bind(databaseValue(col, node.value)));
                case "lte":
                  return lte(col, bind(databaseValue(col, node.value)));
                case "in":
                  shape.push(node.value.length);
                  return inArray(
                    col,
                    node.value.map((value: unknown) =>
                      bind(databaseValue(col, value)),
                    ),
                  );
                case "notIn":
                  shape.push(node.value.length);
                  return notInArray(
                    col,
                    node.value.map((value: unknown) =>
                      bind(databaseValue(col, value)),
                    ),
                  );
                case "between":
                  return between(
                    col,
                    bind(databaseValue(col, node.value[0])),
                    bind(databaseValue(col, node.value[1])),
                  );
                case "isNull":
                  return isNull(col);
                case "isNotNull":
                  return isNotNull(col);
                case "contains":
                case "startsWith":
                case "endsWith": {
                  const escaped = String(node.value).replace(/[\\%_]/g, "\\$&");
                  const pattern =
                    node.op === "contains"
                      ? `%${escaped}%`
                      : node.op === "startsWith"
                        ? `${escaped}%`
                        : `%${escaped}`;
                  return sql`${col} LIKE ${bind(pattern)} ESCAPE '\\'`;
                }
                default:
                  return invalid("Unknown filter operator");
              }
            };
            const where = and(
              scope,
              input.where ? condition(input.where) : undefined,
              ["get", "update", "delete"].includes(operation)
                ? eq(idColumn, bind(databaseValue(idColumn, input.id)))
                : undefined,
            );
            const selected: string[] = input.select ?? readable;
            const selectedProjection = Object.fromEntries(
              selected.map((key) => [key, columns[key]]),
            );
            // A sentinel permits resources with no readable fields without exposing the ID.
            const dbProjection = selected.length
              ? selectedProjection
              : { __brickSentinel: idColumn };
            const scrub = async (row: Record<string, unknown>) => {
              const result: Record<string, unknown> = {};
              for (const key of selected)
                result[key] = fields[key].scrub
                  ? await fields[key].scrub!({
                      value: jsonValue(row[key]),
                      ctx,
                    })
                  : jsonValue(row[key]);
              return result;
            };
            const key = (suffix: string) =>
              JSON.stringify([
                operation,
                suffix,
                shape,
                selected,
                input.orderBy,
              ]);
            if (["list", "findOne", "get"].includes(operation)) {
              const limit =
                operation === "list" ? (input.limit ?? defaultLimit) : 1;
              const offset = input.offset ?? 0;
              const ordering = (input.orderBy ?? []).map((sort: any) =>
                sort.direction === "desc"
                  ? desc(columns[sort.field])
                  : asc(columns[sort.field]),
              );
              const boundLimit = bind(limit),
                boundOffset = bind(offset);
              const rows = await executeQuery(
                db,
                key("rows"),
                () =>
                  db
                    .select(dbProjection)
                    .from(resource.table)
                    .where(where)
                    .orderBy(...ordering)
                    .limit(boundLimit)
                    .offset(boundOffset),
                params,
                cacheable,
              );
              if (operation === "get") {
                if (!rows[0])
                  throw new ActionExecutionError(
                    "NOT_FOUND",
                    "Resource not found",
                    404,
                  );
                return scrub(rows[0]);
              }
              if (operation === "findOne")
                return rows[0] ? scrub(rows[0]) : null;
              const result: any = {
                items: await Promise.all(rows.map(scrub)),
                limit,
                offset,
              };
              if (input.includeTotal) {
                const counts = await executeQuery(
                  db,
                  key("total"),
                  () =>
                    db
                      .select({ count: sql<number>`count(*)`.mapWith(Number) })
                      .from(resource.table)
                      .where(where),
                  params,
                  cacheable,
                );
                result.total = counts[0].count;
              }
              return result;
            }
            if (operation === "count") {
              const rows = await executeQuery(
                db,
                key("count"),
                () =>
                  db
                    .select({ count: sql<number>`count(*)`.mapWith(Number) })
                    .from(resource.table)
                    .where(where),
                params,
                cacheable,
              );
              return { count: rows[0].count };
            }
            if (operation === "exists") {
              const rows = await executeQuery(
                db,
                key("exists"),
                () =>
                  db
                    .select({ id: idColumn })
                    .from(resource.table)
                    .where(where)
                    .limit(1),
                params,
                cacheable,
              );
              return { exists: rows.length > 0 };
            }
            if (operation === "delete") {
              await options.hooks?.beforeDelete?.({ id: input.id, ctx, error });
              const rows = await executeQuery(
                db,
                key("delete"),
                () =>
                  db
                    .delete(resource.table)
                    .where(where)
                    .returning({ id: idColumn }),
                params,
                cacheable,
              );
              if (!rows.length)
                throw new ActionExecutionError(
                  "NOT_FOUND",
                  "Resource not found",
                  404,
                );
              await options.hooks?.afterDelete?.({ id: input.id, ctx, error });
              return { success: true };
            }
            const data = { ...(operation === "create" ? input : input.data) };
            if (operation === "create")
              await options.hooks?.beforeCreate?.({ data, ctx, error });
            else
              await options.hooks?.beforeUpdate?.({
                id: input.id,
                data,
                ctx,
                error,
              });
            // Hooks are trusted and may set internal columns, but must use real table keys.
            for (const field of Object.keys(data))
              if (!own(columns, field))
                throw new Error(`Write hook supplied unknown field '${field}'`);
            if (operation === "update" && !Object.keys(data).length)
              invalid("Update requires at least one field");
            // Create scope cannot be enforced with INSERT WHERE: require explicit authorization.
            if (operation === "create" && scope)
              throw new ActionExecutionError(
                "FORBIDDEN",
                "Row-scoped creation requires an explicit create policy",
                403,
              );
            const writeFields = Object.keys(data).sort();
            const boundData = Object.fromEntries(
              writeFields.map((field) => [
                field,
                bind(databaseValue(columns[field], data[field])),
              ]),
            );
            shape.push(writeFields);
            const safeCache =
              cacheable &&
              !writeFields.some(
                (field) =>
                  columns[field].defaultFn || columns[field].onUpdateFn,
              ) &&
              !Object.values(columns).some(
                (column) => column.defaultFn || column.onUpdateFn,
              );
            const rows = await executeQuery(
              db,
              key("write"),
              () =>
                operation === "create"
                  ? db
                      .insert(resource.table)
                      .values(boundData)
                      .returning(columns)
                  : db
                      .update(resource.table)
                      .set(boundData)
                      .where(where)
                      .returning(columns),
              params,
              safeCache,
            ).catch((cause: unknown) => {
              if (uniqueViolation(cause))
                throw new ActionExecutionError(
                  "CONFLICT",
                  "Resource already exists",
                  409,
                );
              throw cause;
            });

            if (!rows[0])
              throw new ActionExecutionError(
                "NOT_FOUND",
                "Resource not found",
                404,
              );
            if (operation === "create")
              await options.hooks?.afterCreate?.({ row: rows[0], ctx, error });
            else
              await options.hooks?.afterUpdate?.({
                id: input.id,
                row: rows[0],
                ctx,
                error,
              });
            return scrub(rows[0]);
          },
        });
        // Pre-validation depth guard: action input validation runs before
        // execute()/condition(), so reject over-nested `where` here instead
        // of recursing inside the compiled TypeBox check.
        // Runtime output validation accepts subset projections while the
        // published `config.output` stays strict for contracts/OpenAPI.
        action.outputValidationSchema = looseOutputs[operation];
        const innerValidateInput = action.validateInput.bind(action);
        action.validateInput = (rawInput: unknown) =>
          whereDepthExceeded(rawInput)
            ? {
                success: false as const,
                errors: [
                  {
                    path: "where",
                    message: `Filter nesting exceeds ${MAX_WHERE_DEPTH} levels`,
                  },
                ],
              }
            : innerValidateInput(rawInput);
        api[operation] = action;
      }
      service.contributePreparation({
        name: `crud:${resource.name}`,
        describe: () => ({
          plugin: "@brickkit/crud",
          resource: resource.name,
          operations: Object.keys(api),
          inputs: Object.fromEntries(
            Object.keys(api).map((operation) => [
              operation,
              inputs[operation as Operation],
            ]),
          ),
          outputs: Object.fromEntries(
            Object.keys(api).map((operation) => [
              operation,
              outputs[operation as Operation],
            ]),
          ),
          defaultLimit,
          maxLimit,
          cacheLimit: 128,
        }),
        prepare: () => {
          const db: any = service.getDb();
          if (
            !db?.$client?.prepare ||
            options.access?.scope ||
            Object.values(columns).some(
              (column) => column.defaultFn || column.onUpdateFn,
            )
          )
            return;
          let cache = prepared.get(db);
          if (!cache) {
            cache = new Map();
            prepared.set(db, cache);
          }
          const dbProjection = readable.length
            ? projection
            : { __brickSentinel: idColumn };
          if (api.list)
            cache.set(
              JSON.stringify(["list", "rows", [], readable, undefined]),
              db
                .select(dbProjection)
                .from(resource.table)
                .limit(sql.placeholder("p0"))
                .offset(sql.placeholder("p1"))
                .prepare(),
            );
          if (api.get)
            cache.set(
              JSON.stringify(["get", "rows", [], readable, undefined]),
              db
                .select(dbProjection)
                .from(resource.table)
                .where(eq(idColumn, sql.placeholder("p0")))
                .limit(sql.placeholder("p1"))
                .offset(sql.placeholder("p2"))
                .prepare(),
            );
        },
      });
      return api;
    },
  });
  return descriptor as CrudPlugin<F, O>;
}
