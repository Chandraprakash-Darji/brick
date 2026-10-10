import type { Table, SQL, Column, GetColumnData } from "drizzle-orm";
import type { TSchema, TUnsafe, Static } from "@sinclair/typebox";
import type {
  Action,
  ErrorBuilder,
  ActionContext,
  ResourcePlugin,
  PluginRoutes,
} from "@brickkit/core";

export type FilterOperator =
  | "eq"
  | "ne"
  | "in"
  | "notIn"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "isNull"
  | "isNotNull";
export interface FieldPolicy {
  read?: boolean;
  create?: boolean;
  update?: boolean;
  filter?: readonly FilterOperator[];
  sort?: boolean;
  schema?: TSchema;
  scrub?: (args: {
    value: any;
    ctx: ActionContext;
  }) => unknown | Promise<unknown>;
}
export type Fields = Readonly<Record<string, FieldPolicy>>;
export type Operation =
  | "list"
  | "get"
  | "create"
  | "update"
  | "delete"
  | "findOne"
  | "count"
  | "exists";
export type Operations = false | Partial<Record<Operation, boolean>>;
export interface CrudOptions<
  F extends Fields = Fields,
  O extends Operations = Operations,
> {
  fields: F;
  operations?: O;
  routes?: PluginRoutes;
  defaultLimit?: number;
  maxLimit?: number;
  access?: {
    authorize?: (args: {
      operation: Operation;
      input: unknown;
      ctx: ActionContext;
    }) => boolean | Promise<boolean>;
    scope?: (args: {
      operation: Operation;
      ctx: ActionContext;
    }) => SQL | undefined | Promise<SQL | undefined>;
  };
  hooks?: {
    beforeCreate?: (args: {
      data: Record<string, unknown>;
      ctx: ActionContext;
      error: ErrorBuilder<Record<string, never>>;
    }) => void | Promise<void>;
    afterCreate?: (args: {
      row: Record<string, unknown>;
      ctx: ActionContext;
      error: ErrorBuilder<Record<string, never>>;
    }) => void | Promise<void>;
    afterUpdate?: (args: {
      id: unknown;
      row: Record<string, unknown>;
      ctx: ActionContext;
      error: ErrorBuilder<Record<string, never>>;
    }) => void | Promise<void>;
    beforeDelete?: (args: {
      id: unknown;
      ctx: ActionContext;
      error: ErrorBuilder<Record<string, never>>;
    }) => void | Promise<void>;
    afterDelete?: (args: {
      id: unknown;
      ctx: ActionContext;
      error: ErrorBuilder<Record<string, never>>;
    }) => void | Promise<void>;
    beforeUpdate?: (args: {
      id: unknown;
      data: Record<string, unknown>;
      ctx: ActionContext;
      error: ErrorBuilder<Record<string, never>>;
    }) => void | Promise<void>;
  };
}
type Row<T extends Table> = T["$inferSelect"];
type Keys<F, P extends string> = {
  [K in keyof F]: F[K] extends Record<P, true> ? K : never;
}[keyof F];
type ReadKeys<T extends Table, F> = Extract<Keys<F, "read">, keyof Row<T>>;
export type ReadRow<T extends Table, F> = {
  [K in ReadKeys<T, F>]: F[K] extends { scrub: (...args: any[]) => infer V }
    ? Awaited<V>
    : F[K] extends { schema: infer S extends TSchema }
      ? Static<S>
      : Row<T>[K];
};
type WriteKeys<T extends Table, F, P extends string> = Extract<
  Keys<F, P>,
  keyof T["$inferInsert"]
>;
type WriteRow<T extends Table, F, P extends string> = Pick<
  T["$inferInsert"],
  WriteKeys<T, F, P>
>;
type AllowedOps<F, K extends keyof F> = F[K] extends {
  filter: readonly (infer O)[];
}
  ? O
  : never;
type Operand<V, O> = O extends "isNull" | "isNotNull"
  ? {}
  : O extends "in" | "notIn"
    ? { value: readonly NonNullable<V>[] }
    : O extends "between"
      ? { value: readonly [NonNullable<V>, NonNullable<V>] }
      : { value: NonNullable<V> };
type Leaf<T extends Table, F> = {
  [K in Extract<keyof F, keyof Row<T>>]: {
    [O in Extract<AllowedOps<F, K>, FilterOperator>]: {
      field: K;
      op: O;
    } & Operand<Row<T>[K], O>;
  }[Extract<AllowedOps<F, K>, FilterOperator>];
}[Extract<keyof F, keyof Row<T>>];
export type Where<T extends Table, F> =
  | Leaf<T, F>
  | { and: readonly Where<T, F>[] }
  | { or: readonly Where<T, F>[] };
export interface Query<
  T extends Table,
  F,
  S extends readonly ReadKeys<T, F>[] | undefined = undefined,
> {
  select?: S;
  where?: Where<T, F>;
  orderBy?: readonly {
    field: Extract<Keys<F, "sort">, keyof Row<T>>;
    direction: "asc" | "desc";
  }[];
  limit?: number;
  offset?: number;
  includeTotal?: boolean;
}
type Selected<T extends Table, F, S> = S extends readonly (infer K)[]
  ? Pick<ReadRow<T, F>, Extract<K, keyof ReadRow<T, F>>>
  : ReadRow<T, F>;
type Callable<I, R, C> = Action<
  TUnsafe<I>,
  TUnsafe<R>,
  Record<string, never>,
  C extends ActionContext ? C : ActionContext
>;
interface QueryAction<
  T extends Table,
  F,
  C,
  Kind extends "list" | "findOne",
> extends Omit<
  Callable<
    Query<T, F, readonly ReadKeys<T, F>[] | undefined>,
    Kind extends "list"
      ? {
          items: ReadRow<T, F>[];
          total?: number;
          limit: number;
          offset: number;
        }
      : ReadRow<T, F> | null,
    C
  >,
  "run"
> {
  <const S extends readonly ReadKeys<T, F>[] | undefined = undefined>(params: {
    input: Query<T, F, S>;
    ctx?: Partial<C>;
  }): Promise<
    Kind extends "list"
      ? {
          items: Selected<T, F, S>[];
          total?: number;
          limit: number;
          offset: number;
        }
      : Selected<T, F, S> | null
  >;
  run<const S extends readonly ReadKeys<T, F>[] | undefined = undefined>(
    input: Query<T, F, S>,
    ctx?: Partial<C>,
  ): Promise<
    Kind extends "list"
      ? {
          items: Selected<T, F, S>[];
          total?: number;
          limit: number;
          offset: number;
        }
      : Selected<T, F, S> | null
  >;
}
interface GetAction<T extends Table, F, C, ID> extends Omit<
  Callable<{ id: ID; select?: readonly ReadKeys<T, F>[] }, ReadRow<T, F>, C>,
  "run" | "execute"
> {
  <const S extends readonly ReadKeys<T, F>[] | undefined = undefined>(params: {
    input: { id: ID; select?: S };
    ctx?: Partial<C>;
  }): Promise<Selected<T, F, S>>;
  run<const S extends readonly ReadKeys<T, F>[] | undefined = undefined>(
    input: { id: ID; select?: S },
    ctx?: Partial<C>,
  ): Promise<Selected<T, F, S>>;
  execute<
    const S extends readonly ReadKeys<T, F>[] | undefined = undefined,
  >(params: {
    input: { id: ID; select?: S };
    ctx?: Partial<C>;
  }): Promise<Selected<T, F, S>>;
}
type AllAPI<T extends Table, C, F, ID> = {
  list: QueryAction<T, F, C, "list">;
  findOne: QueryAction<T, F, C, "findOne">;
  get: GetAction<T, F, C, ID>;
  create: Callable<WriteRow<T, F, "create">, ReadRow<T, F>, C>;
  update: Callable<
    { id: ID; data: Partial<WriteRow<T, F, "update">> },
    ReadRow<T, F>,
    C
  >;
  delete: Callable<{ id: ID }, { success: true }, C>;
  count: Callable<{ where?: Where<T, F> }, { count: number }, C>;
  exists: Callable<{ where?: Where<T, F> }, { exists: boolean }, C>;
};
export type CrudAPI<T extends Table, C, F, O, ID = Row<T>[keyof Row<T>]> = [
  O,
] extends [false]
  ? {}
  : Pick<
      AllAPI<T, C, F, ID>,
      { [K in Operation]: O extends Record<K, false> ? never : K }[Operation]
    >;
export interface CrudTypes<F, O> {
  readonly table: unknown;
  readonly context: unknown;
  readonly resource: unknown;
  readonly api: this["table"] extends Table
    ? CrudAPI<
        this["table"],
        this["context"],
        F,
        O,
        this["resource"] extends { config: { id: infer I extends Column } }
          ? GetColumnData<I, "raw">
          : this["table"]["$inferSelect"][keyof this["table"]["$inferSelect"]]
      >
    : {};
}
export type CrudPlugin<F extends Fields, O extends Operations> = ResourcePlugin<
  any,
  any,
  object
> & { readonly types: CrudTypes<F, O> };
