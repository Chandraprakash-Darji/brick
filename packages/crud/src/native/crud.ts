import { Effect, Schema } from "effect";
import {
  and,
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
  getTableColumns,
  extractExtendedColumnType,
  type SQL,
  type Column,
  type InferSelectModel,
  type Table,
  type InferInsertModel,
} from "drizzle-orm";
import {
  createSelectSchema,
  createInsertSchema,
  createUpdateSchema,
} from "drizzle-orm/effect-schema";
import type { Store } from "./store";
import { SqlError } from "effect/sql";

export class InvalidInput extends Schema.TaggedError<InvalidInput>()(
  "InvalidInput",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}
export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}
export class Conflict extends Schema.TaggedError<Conflict>()(
  "Conflict",
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}
export class DatabaseFailure extends Schema.TaggedError<DatabaseFailure>()(
  "DatabaseFailure",
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}
export const builtinErrors = [
  InvalidInput,
  Forbidden,
  NotFound,
  Conflict,
  DatabaseFailure,
] as const;
export type Operator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "between"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "isNull"
  | "isNotNull";
export type FieldPolicy<Value = unknown> = {
  readonly schema?: Schema.Codec<NonNullable<Value>>;
  readonly read?: boolean;
  readonly create?: boolean;
  readonly update?: boolean;
  readonly sort?: boolean;
  readonly filter?: readonly Operator[];
};
export type Fields<T extends Table> = {
  readonly [K in keyof InferSelectModel<T>]?: FieldPolicy<
    InferSelectModel<T>[K]
  >;
};
type Keys<F, P extends string> = {
  [K in keyof F]: F[K] extends Record<P, true> ? K : never;
}[keyof F];
export type ReadRow<T extends Table, F> = Pick<
  InferSelectModel<T>,
  Extract<Keys<F, "read">, keyof InferSelectModel<T>>
>;
type WriteRow<T extends Table, F, P extends string> = Pick<
  InferInsertModel<T>,
  Extract<Keys<F, P>, keyof InferInsertModel<T>>
>;
type Operand<V, O> = O extends "isNull" | "isNotNull"
  ? {}
  : O extends "in" | "notIn"
    ? { readonly value: readonly NonNullable<V>[] }
    : O extends "between"
      ? { readonly value: readonly [NonNullable<V>, NonNullable<V>] }
      : { readonly value: NonNullable<V> };
type Leaf<T extends Table, F> = {
  [K in Extract<keyof F, keyof InferSelectModel<T>>]: F[K] extends {
    filter: readonly (infer O)[];
  }
    ? {
        [P in Extract<O, Operator>]: {
          readonly field: K;
          readonly op: P;
        } & Operand<InferSelectModel<T>[K], P>;
      }[Extract<O, Operator>]
    : never;
}[Extract<keyof F, keyof InferSelectModel<T>>];
export type Where<T extends Table, F> =
  | Leaf<T, F>
  | { readonly and: readonly Where<T, F>[] }
  | { readonly or: readonly Where<T, F>[] };
export type Query<T extends Table, F> = {
  readonly where?: Where<T, F>;
  readonly orderBy?: readonly {
    readonly field: Extract<Keys<F, "sort">, string>;
    readonly direction: "asc" | "desc";
  }[];
  readonly limit?: number;
  readonly offset?: number;
  readonly includeTotal?: boolean;
};
export type Inputs<T extends Table, F, ID> = {
  list: Query<T, F>;
  findOne: Query<T, F>;
  get: { readonly id: ID };
  create: WriteRow<T, F, "create">;
  update: { readonly id: ID; readonly data: Partial<WriteRow<T, F, "update">> };
  delete: { readonly id: ID };
  count: { readonly where?: Where<T, F> };
  exists: { readonly where?: Where<T, F> };
};
export type Operation = keyof Inputs<Table, {}, unknown>;
export type Authorization<I> = {
  [O in keyof I]: { readonly operation: O; readonly input: I[O] };
}[keyof I];
export type HookShape<T extends Table, F, ID, E, R> = {
  readonly beforeCreate?: (args: {
    readonly data: WriteRow<T, F, "create">;
  }) => Effect.Effect<InferInsertModel<T>, E, R>;
  readonly afterCreate?: (args: {
    readonly row: InferSelectModel<T>;
  }) => Effect.Effect<void, E, R>;
  readonly beforeUpdate?: (args: {
    readonly id: ID;
    readonly data: Partial<WriteRow<T, F, "update">>;
  }) => Effect.Effect<Partial<InferInsertModel<T>>, E, R>;
  readonly afterUpdate?: (args: {
    readonly id: ID;
    readonly row: InferSelectModel<T>;
  }) => Effect.Effect<void, E, R>;
  readonly beforeDelete?: (args: {
    readonly id: ID;
  }) => Effect.Effect<void, E, R>;
  readonly afterDelete?: (args: {
    readonly id: ID;
  }) => Effect.Effect<void, E, R>;
};
export type Scrubbers<T extends Table, F, E, R> = {
  readonly [K in keyof ReadRow<T, F>]?: (args: {
    readonly value: ReadRow<T, F>[K];
    readonly row: InferSelectModel<T>;
  }) => Effect.Effect<ReadRow<T, F>[K], E, R>;
};

export interface CrudAction<I, O, E, R> {
  readonly input: Schema.Codec<I>;
  readonly output: Schema.Codec<O>;
  readonly handler: (input: I) => Effect.Effect<O, E, R>;
  readonly decode: (input: unknown) => Effect.Effect<O, E | InvalidInput, R>;
}
function definition<I, O, E, R>(
  input: Schema.Codec<I>,
  output: Schema.Codec<O>,
  handler: (input: I) => Effect.Effect<O, E, R>,
): CrudAction<I, O, E, R> {
  return Object.freeze({
    input,
    output,
    handler,
    decode: (value: unknown) =>
      Schema.decodeUnknownEffect(input)(value, {
        onExcessProperty: "error",
      }).pipe(
        Effect.mapError((e) => new InvalidInput({ message: String(e) })),
        Effect.flatMap(handler),
      ),
  });
}
const invalid = (message: string) => new InvalidInput({ message });
/** Dynamic keys are derived only from validated table/policy keys. The assertion
 * preserves their mapped types after Object.entries erases that correlation. */
export const contract = <A>(
  fields: Record<string, Schema.Top>,
): Schema.Codec<A> => Schema.Struct(fields) as unknown as Schema.Codec<A>;
const record = Schema.Record(Schema.String, Schema.Unknown);
const Int = Schema.Number.check(Schema.isInt());

export function crudSchemas<
  T extends Table,
  const F extends Fields<T>,
  K extends keyof InferSelectModel<T>,
>(options: {
  readonly table: T;
  readonly id: K;
  readonly fields: F;
  readonly defaultLimit?: number;
  readonly maxLimit?: number;
}) {
  type I = Inputs<T, F, InferSelectModel<T>[K]>;
  type Read = ReadRow<T, F>;
  const fields = Object.freeze(
    Object.fromEntries(
      Object.entries(options.fields as Record<string, FieldPolicy>).map(
        ([k, p]) => [
          k,
          Object.freeze({
            ...p,
            filter: p.filter ? Object.freeze([...p.filter]) : undefined,
          }),
        ],
      ),
    ),
  );
  const table = options.table;
  const columns: Record<string, Column> = getTableColumns(table);
  const id = columns[String(options.id)];
  const max = options.maxLimit ?? 1000;
  const defaultLimit = options.defaultLimit ?? 50;
  if (
    !Number.isInteger(max) ||
    max < 1 ||
    !Number.isInteger(defaultLimit) ||
    defaultLimit < 1 ||
    defaultLimit > max
  )
    throw new Error("Invalid CRUD limits");
  for (const [key, p] of Object.entries(fields)) {
    if (!Object.hasOwn(columns, key))
      throw new Error(`Unknown CRUD field ${key}`);
    if (key === options.id && p.update)
      throw new Error("Identifier cannot be updated");
  }
  const readable = Object.keys(fields).filter((k) => fields[k].read);
  if (readable.length === 0)
    throw new Error("CRUD needs at least one readable field");
  const codecs: Record<
    string,
    (schema: Schema.Codec<unknown>) => Schema.Codec<unknown>
  > = {};
  for (const [key, column] of Object.entries(columns)) {
    if (extractExtendedColumnType(column).constraint === "date")
      codecs[key] = () => Schema.DateFromString;
    if (extractExtendedColumnType(column).type === "bigint")
      codecs[key] = () => Schema.BigIntFromString;
  }
  const direct: Record<string, Schema.Codec<unknown>> = {};
  for (const [key, column] of Object.entries(columns)) {
    const { type, constraint } = extractExtendedColumnType(column);
    const length =
      "length" in column && typeof column.length === "number"
        ? column.length
        : undefined;
    if (
      length &&
      type === "string" &&
      "isLengthExact" in column &&
      column.isLengthExact
    ) {
      direct[key] = Schema.String.check(
        Schema.isMinLength(length),
        Schema.isMaxLength(length),
      );
    }
    if (
      length &&
      type === "array" &&
      ["vector", "halfvector", "int64vector"].includes(constraint ?? "")
    ) {
      const item =
        constraint === "int64vector"
          ? Schema.BigIntFromString.check(
              Schema.isGreaterThanOrEqualToBigInt(-(2n ** 63n)),
              Schema.isLessThanOrEqualToBigInt(2n ** 63n - 1n),
            )
          : Schema.Number;
      direct[key] = Schema.Array(item).check(
        Schema.isMinLength(length),
        Schema.isMaxLength(length),
      );
    }
    if (fields[key]?.schema) {
      const schema = fields[key].schema;
      if (schema) codecs[key] = () => schema;
    }
  }
  const refinements = (kind: "select" | "insert" | "update") => {
    const overrides: Record<
      string,
      | Schema.Codec<unknown>
      | ((schema: Schema.Codec<unknown>) => Schema.Codec<unknown>)
    > = { ...codecs };
    for (const [key, original] of Object.entries(direct)) {
      const column = columns[key];
      let schema = fields[key]?.schema ?? original;
      if (!column.notNull) schema = Schema.NullOr(schema);
      if (
        kind === "update" ||
        (kind === "insert" && (!column.notNull || column.hasDefault))
      )
        schema = Schema.optionalKey(schema);
      overrides[key] = schema;
    }
    return overrides;
  };
  const runtimeTable: Table = table;
  const rowFields: Record<string, Schema.Codec<unknown>> = createSelectSchema(
    runtimeTable,
    refinements("select"),
  ).fields;
  const insertFields: Record<
    string,
    Schema.Codec<unknown>
  > = createInsertSchema(runtimeTable, refinements("insert")).fields;
  const updateFields: Record<
    string,
    Schema.Codec<unknown>
  > = createUpdateSchema(runtimeTable, refinements("update")).fields;
  const pick = (
    source: Record<string, Schema.Top>,
    kind: "read" | "create" | "update",
  ) =>
    Object.fromEntries(
      Object.keys(fields)
        .filter((k) => fields[k][kind])
        .map((k) => [k, source[k]]),
    );
  const rowSchema = contract<Read>(pick(rowFields, "read"));
  const createSchema = contract<I["create"]>(pick(insertFields, "create"));
  const updateSchema = contract<I["update"]["data"]>(
    pick(updateFields, "update"),
  );
  const idSchema = rowFields[String(options.id)];
  const leaves: Schema.Top[] = [];
  for (const [field, policy] of Object.entries(fields))
    for (const op of policy.filter ?? []) {
      const value = rowFields[field].check(
        Schema.makeFilter((value) => value !== null),
      );
      const operand: Record<string, Schema.Top> =
        op === "isNull" || op === "isNotNull"
          ? {}
          : op === "between"
            ? { value: Schema.Tuple([value, value]) }
            : op === "in" || op === "notIn"
              ? {
                  value: Schema.Array(value).check(
                    Schema.isMinLength(1),
                    Schema.isMaxLength(1000),
                  ),
                }
              : { value };
      leaves.push(
        Schema.Struct({
          field: Schema.Literal(field),
          op: Schema.Literal(op),
          ...operand,
        }).annotate({ parseOptions: { onExcessProperty: "error" } }),
      );
    }
  const recursive: Schema.Codec<Where<T, F>> = Schema.suspend(() =>
    Schema.Union([
      ...leaves,
      Schema.Struct({
        and: Schema.Array(recursive).check(
          Schema.isMinLength(1),
          Schema.isMaxLength(50),
        ),
      }).annotate({ parseOptions: { onExcessProperty: "error" } }),
      Schema.Struct({
        or: Schema.Array(recursive).check(
          Schema.isMinLength(1),
          Schema.isMaxLength(50),
        ),
      }).annotate({ parseOptions: { onExcessProperty: "error" } }),
    ]),
  ) as unknown as Schema.Codec<Where<T, F>>;
  const querySchema = contract<I["list"]>({
    where: Schema.optionalKey(recursive),
    orderBy: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          field: Schema.String,
          direction: Schema.Literals(["asc", "desc"]),
        }),
      ),
    ),
    limit: Schema.optionalKey(Int),
    offset: Schema.optionalKey(Int),
    includeTotal: Schema.optionalKey(Schema.Boolean),
  });
  const filterSchema = contract<I["count"]>({
    where: Schema.optionalKey(recursive),
  });

  return {
    fields,
    table,
    columns,
    id,
    max,
    defaultLimit,
    readable,
    rowFields,
    rowSchema,
    createSchema,
    updateSchema,
    idSchema,
    querySchema,
    filterSchema,
  };
}

export function crud<
  T extends Table,
  const F extends Fields<T>,
  K extends keyof InferSelectModel<T>,
  Db,
  const O extends false | Partial<Record<Operation, boolean>> = {},
  E = never,
  R = never,
>(options: {
  readonly table: T;
  readonly id: K;
  readonly store: Store<T, Db>;
  readonly fields: F;
  readonly access:
    | "public"
    | {
        readonly authorize: (
          args: Authorization<Inputs<T, F, InferSelectModel<T>[K]>>,
        ) => Effect.Effect<boolean, E, R>;
        readonly scope?: (args: {
          readonly operation: Operation;
        }) => Effect.Effect<SQL | undefined, E, R>;
      };
  readonly operations?: O;
  readonly hooks?: HookShape<T, F, InferSelectModel<T>[K], E, R>;
  readonly scrub?: Scrubbers<T, F, E, R>;
  readonly defaultLimit?: number;
  readonly maxLimit?: number;
}) {
  type I = Inputs<T, F, InferSelectModel<T>[K]>;
  type Row = InferSelectModel<T>;
  type Read = ReadRow<T, F>;
  const {
    fields,
    columns,
    id,
    max,
    defaultLimit,
    readable,
    rowFields,
    rowSchema,
    createSchema,
    updateSchema,
    idSchema,
    querySchema,
    filterSchema,
  } = crudSchemas(options);
  const hooks = Object.freeze({ ...options.hooks });
  // Only policy-validated readable keys index this runtime view. Public callbacks
  // retain each column's value type and their exact failure/service channels.
  const scrubbers = Object.freeze({ ...options.scrub }) as Record<
    string,
    | ((args: { value: unknown; row: Row }) => Effect.Effect<unknown, E, R>)
    | undefined
  >;
  const access =
    options.access === "public"
      ? "public"
      : Object.freeze({ ...options.access });
  const store = options.store;
  const policy = (args: Authorization<I>) =>
    Effect.gen(function* () {
      if (access === "public") return undefined;
      if (!(yield* access.authorize(args)))
        return yield* new Forbidden({ message: "Access denied" });
      const scope = access.scope
        ? yield* access.scope({ operation: args.operation })
        : undefined;
      if (args.operation === "create" && scope)
        return yield* new Forbidden({
          message: "Create requires an explicit ownership hook",
        });
      return scope;
    });
  const filter = (
    root: unknown,
  ): Effect.Effect<SQL | undefined, InvalidInput> =>
    Effect.gen(function* () {
      if (root === undefined) return undefined;
      let visited = 0;
      const visit = (
        node: unknown,
        depth: number,
      ): Effect.Effect<SQL, InvalidInput> =>
        Effect.gen(function* () {
          if (++visited > 1000)
            return yield* invalid("Filter exceeds 1000 nodes");
          if (depth > 20) return yield* invalid("Filter nesting exceeds 20");
          const n = yield* Schema.decodeUnknownEffect(record)(node).pipe(
            Effect.mapError(() => invalid("Invalid filter")),
          );
          if ("and" in n || "or" in n) {
            const key = "and" in n ? "and" : "or";
            if (
              Object.keys(n).length !== 1 ||
              !Array.isArray(n[key]) ||
              n[key].length < 1 ||
              n[key].length > 50
            )
              return yield* invalid("Invalid filter group");
            const parts: SQL[] = [];
            for (const child of n[key])
              parts.push(yield* visit(child, depth + 1));
            return sql`(${sql.join(parts, key === "and" ? sql` and ` : sql` or `)})`;
          }
          if (
            typeof n.field !== "string" ||
            typeof n.op !== "string" ||
            !Object.hasOwn(fields, n.field) ||
            !fields[n.field].filter?.includes(n.op as Operator)
          )
            return yield* invalid("Filter is not allowed");
          const column = columns[n.field];
          const schema = rowFields[n.field];
          const nullary = n.op === "isNull" || n.op === "isNotNull";
          if (
            Object.keys(n).some(
              (k) =>
                !["field", "op", ...(nullary ? [] : ["value"])].includes(k),
            )
          )
            return yield* invalid("Invalid filter keys");
          if (nullary)
            return n.op === "isNull" ? isNull(column) : isNotNull(column);
          const decode = (v: unknown) =>
            Schema.decodeUnknownEffect(Schema.toType(schema))(v).pipe(
              Effect.mapError(() => invalid("Invalid filter value")),
            );
          if (n.op === "in" || n.op === "notIn" || n.op === "between") {
            if (
              !Array.isArray(n.value) ||
              n.value.length < 1 ||
              n.value.length > 1000 ||
              (n.op === "between" && n.value.length !== 2)
            )
              return yield* invalid("Invalid filter array");
            const values: unknown[] = [];
            for (const v of n.value) values.push(yield* decode(v));
            return n.op === "in"
              ? inArray(column, values)
              : n.op === "notIn"
                ? notInArray(column, values)
                : between(column, values[0], values[1]);
          }
          const value = yield* decode(n.value);
          switch (n.op) {
            case "eq":
              return eq(column, value);
            case "ne":
              return ne(column, value);
            case "gt":
              return gt(column, value);
            case "gte":
              return gte(column, value);
            case "lt":
              return lt(column, value);
            case "lte":
              return lte(column, value);
            case "contains":
            case "startsWith":
            case "endsWith": {
              if (typeof value !== "string")
                return yield* invalid("String filter required");
              const escaped = value.replace(/[\\%_]/g, "\\$&");
              const pattern =
                n.op === "contains"
                  ? `%${escaped}%`
                  : n.op === "startsWith"
                    ? `${escaped}%`
                    : `%${escaped}`;
              return sql`${column} like ${pattern} escape ${"\\"}`;
            }
            default:
              return yield* invalid("Unknown filter operator");
          }
        });
      return yield* visit(root, 0);
    });
  const projection = (row: Row) =>
    Effect.gen(function* () {
      const values: [string, unknown][] = [];
      for (const key of readable) {
        const original = (row as Record<string, unknown>)[key];
        const scrub = scrubbers[key];
        values.push([
          key,
          scrub ? yield* scrub({ value: original, row }) : original,
        ]);
      }
      return Object.fromEntries(values) as Read;
    });
  const dbError = (error: unknown): Conflict | DatabaseFailure => {
    const queue: unknown[] = [error];
    const seen = new Set<object>();
    for (let i = 0; i < queue.length && i < 100; i++) {
      const node = queue[i];
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      if (
        "code" in node &&
        [
          "23505",
          "SQLITE_CONSTRAINT_UNIQUE",
          "SQLITE_CONSTRAINT_PRIMARYKEY",
        ].includes(String(node.code))
      )
        return new Conflict({ message: "Unique value already exists" });
      for (const k of ["cause", "reason", "error", "failures", "reasons"]) {
        if (k in node) {
          const v = (node as Record<string, unknown>)[k];
          if (Array.isArray(v)) queue.push(...v);
          else queue.push(v);
        }
      }
    }
    return new DatabaseFailure({ message: "Database operation failed" });
  };
  const transactionError = <A>(
    error: A | SqlError.SqlError,
  ): A | Conflict | DatabaseFailure =>
    error instanceof SqlError.SqlError ? dbError(error) : error;
  const query = (operation: "list" | "findOne", input: I["list"]) =>
    Effect.gen(function* () {
      const scope = yield* policy({ operation, input });
      const condition = and(scope, yield* filter(input.where));
      const limit = input.limit ?? defaultLimit;
      const offset = input.offset ?? 0;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > max ||
        !Number.isInteger(offset) ||
        offset < 0
      )
        return yield* invalid("Invalid pagination");
      const order: SQL[] = [];
      if ((input.orderBy?.length ?? 0) > 20)
        return yield* invalid("Too many sort fields");
      for (const o of input.orderBy ?? []) {
        if (!Object.hasOwn(fields, o.field) || !fields[o.field].sort)
          return yield* invalid("Sort is not allowed");
        order.push(
          o.direction === "asc"
            ? asc(columns[o.field])
            : desc(columns[o.field]),
        );
      }
      const rows = yield* store
        .list({
          where: condition,
          order,
          limit: operation === "findOne" ? 1 : limit,
          offset,
        })
        .pipe(Effect.mapError(dbError));
      const items: Read[] = [];
      for (const row of rows) items.push(yield* projection(row as Row));
      const total = input.includeTotal
        ? yield* store.count(condition).pipe(Effect.mapError(dbError))
        : undefined;
      return {
        items,
        ...(total === undefined ? {} : { total }),
        limit,
        offset,
      };
    });
  const list = definition(
    querySchema,
    contract<{ items: Read[]; total?: number; limit: number; offset: number }>({
      items: Schema.Array(rowSchema),
      total: Schema.optionalKey(Int),
      limit: Int,
      offset: Int,
    }),
    (input) => query("list", input),
  );
  const findOne = definition(querySchema, Schema.NullOr(rowSchema), (input) =>
    query("findOne", input).pipe(Effect.map((r) => r.items[0] ?? null)),
  );
  const get = definition(
    contract<I["get"]>({ id: idSchema }),
    rowSchema,
    (input) =>
      Effect.gen(function* () {
        const scope = yield* policy({ operation: "get", input });
        const rows = yield* store
          .list({
            where: and(eq(id, input.id), scope),
            order: [],
            limit: 1,
            offset: 0,
          })
          .pipe(Effect.mapError(dbError));
        if (!rows[0]) return yield* new NotFound({ message: "Row not found" });
        return yield* projection(rows[0] as Row);
      }),
  );
  const create = definition(createSchema, rowSchema, (input) =>
    Effect.gen(function* () {
      yield* policy({ operation: "create", input });
      return yield* store
        .transaction(
          Effect.gen(function* () {
            const data = hooks.beforeCreate
              ? yield* hooks.beforeCreate({ data: input })
              : input;
            const rows = yield* store
              .create(data as InferInsertModel<T>)
              .pipe(Effect.mapError(dbError));
            const row = rows[0] as Row;
            if (hooks.afterCreate) yield* hooks.afterCreate({ row });
            return yield* projection(row);
          }),
        )
        .pipe(Effect.mapError(transactionError));
    }),
  );
  const update = definition(
    contract<I["update"]>({ id: idSchema, data: updateSchema }),
    rowSchema,
    (input) =>
      Effect.gen(function* () {
        const scope = yield* policy({ operation: "update", input });
        return yield* store
          .transaction(
            Effect.gen(function* () {
              const data = hooks.beforeUpdate
                ? yield* hooks.beforeUpdate(input)
                : input.data;
              if (Object.hasOwn(data, String(options.id)))
                return yield* invalid("Identifier cannot be updated");
              if (Object.keys(data).length === 0)
                return yield* invalid("Empty update");
              const rows = yield* store
                .update(
                  data as Partial<InferInsertModel<T>>,
                  and(eq(id, input.id), scope),
                )
                .pipe(Effect.mapError(dbError));
              if (!rows[0])
                return yield* new NotFound({ message: "Row not found" });
              const row = rows[0] as Row;
              if (hooks.afterUpdate)
                yield* hooks.afterUpdate({ id: input.id, row });
              return yield* projection(row);
            }),
          )
          .pipe(Effect.mapError(transactionError));
      }),
  );
  const remove = definition(
    contract<I["delete"]>({ id: idSchema }),
    Schema.Struct({ success: Schema.Literal(true) }),
    (input) =>
      Effect.gen(function* () {
        const scope = yield* policy({ operation: "delete", input });
        return yield* store
          .transaction(
            Effect.gen(function* () {
              if (hooks.beforeDelete) yield* hooks.beforeDelete(input);
              const rows = yield* store
                .remove(id, and(eq(id, input.id), scope))
                .pipe(Effect.mapError(dbError));
              if (!rows[0])
                return yield* new NotFound({ message: "Row not found" });
              if (hooks.afterDelete) yield* hooks.afterDelete(input);
              return { success: true as const };
            }),
          )
          .pipe(Effect.mapError(transactionError));
      }),
  );
  const countQuery = (operation: "count" | "exists", input: I["count"]) =>
    Effect.gen(function* () {
      const scope = yield* policy({ operation, input });
      const condition = and(scope, yield* filter(input.where));
      return yield* store.count(condition).pipe(Effect.mapError(dbError));
    });
  const count = definition(
    filterSchema,
    Schema.Struct({ count: Int }),
    (input) =>
      countQuery("count", input).pipe(Effect.map((count) => ({ count }))),
  );
  const exists = definition(
    filterSchema,
    Schema.Struct({ exists: Schema.Boolean }),
    (input) =>
      countQuery("exists", input).pipe(
        Effect.map((count) => ({ exists: count > 0 })),
      ),
  );
  const all = Object.freeze({
    list,
    findOne,
    get,
    create,
    update,
    delete: remove,
    count,
    exists,
  });
  type Enabled = O extends false
    ? never
    : { [P in Operation]: O extends Record<P, false> ? never : P }[Operation];
  // Enumeration retains the operation mapping; disabled actions are absent.
  return Object.freeze(
    Object.fromEntries(
      Object.entries(all).filter(
        ([key]) =>
          options.operations !== false &&
          !(
            options.operations && options.operations[key as Operation] === false
          ),
      ),
    ),
  ) as Pick<typeof all, Enabled>;
}
