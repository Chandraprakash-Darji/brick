import { Effect, Schema } from "effect";
import { type InferSelectModel, type Table, type SQL } from "drizzle-orm";
import { endpoint } from "@brickkit/core/contracts";
import {
  builtinErrors,
  crud,
  crudSchemas,
  type Fields,
  type Inputs,
  type Authorization,
  type Operation,
  type HookShape,
  type Scrubbers,
} from "./crud";
import type { Store } from "./store";

type Enabled<O> = O extends false
  ? never
  : { [P in Operation]: O extends Record<P, false> ? never : P }[Operation];
/** One private mapped-key assertion accounts for Object.fromEntries erasing keys.
 * Entries come exclusively from the closed operation record; values stay exact. */
function namedActions<
  const N extends string,
  A extends object,
  const O extends false | Partial<Record<Operation, boolean>>,
>(name: N, values: A, operations: O) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(values)
        .filter(
          ([key]) =>
            operations !== false &&
            !(operations && operations[key as Operation] === false),
        )
        .map(([key, value]) => [`${name}.${key}`, value]),
    ),
  ) as { readonly [P in Extract<keyof A, Enabled<O>> as `${N}.${P}`]: A[P] };
}
export function crudContract<
  T extends Table,
  const F extends Fields<T>,
  K extends keyof InferSelectModel<T>,
  const N extends string,
  const Errors extends readonly Schema.Top[],
  const O extends false | Partial<Record<Operation, boolean>> = {},
>(options: {
  readonly name: N;
  readonly path: `/${string}`;
  readonly table: T;
  readonly id: K;
  readonly fields: F;
  readonly errors: Errors;
  readonly operations?: O;
  readonly limits?: { readonly default?: number; readonly max?: number };
  readonly mcp?: boolean;
}) {
  const limits = {
    defaultLimit: options.limits?.default,
    maxLimit: options.limits?.max,
  };
  const schemas = crudSchemas({ ...options, ...limits });
  const errors: readonly ((typeof builtinErrors)[number] | Errors[number])[] = [
    ...builtinErrors,
    ...options.errors,
  ];
  const base = options.path.replace(/\/$/, "");
  const route = (subpath: string): `/${string}` => {
    if (subpath === "/") return (base || "/") as `/${string}`;
    return `${base}${subpath}` as `/${string}`;
  };
  const int = Schema.Number.check(Schema.isInt());
  type ID = InferSelectModel<T>[K];
  const idParams = Schema.Struct({
    id: schemas.idSchema,
  });
  const all = {
    list: endpoint(`${options.name}.list`, "POST", route("/query"), {
      input: { payload: schemas.querySchema },
      output: Schema.Struct({
        items: Schema.Array(schemas.rowSchema),
        total: Schema.optionalKey(int),
        limit: int,
        offset: int,
      }),
      errors,
      mcp: options.mcp,
    }),
    findOne: endpoint(`${options.name}.findOne`, "POST", route("/find-one"), {
      input: { payload: schemas.querySchema },
      output: Schema.NullOr(schemas.rowSchema),
      errors,
      mcp: options.mcp,
    }),
    get: endpoint(`${options.name}.get`, "GET", route("/:id"), {
      input: { params: idParams },
      output: schemas.rowSchema,
      errors,
      mcp: options.mcp,
    }),
    create: endpoint(`${options.name}.create`, "POST", route("/"), {
      input: { payload: schemas.createSchema },
      output: schemas.rowSchema,
      errors,
      mcp: options.mcp,
    }),
    update: endpoint(`${options.name}.update`, "PATCH", route("/:id"), {
      input: {
        params: idParams,
        payload: schemas.updateSchema,
      },
      output: schemas.rowSchema,
      errors,
      mcp: options.mcp,
    }),
    delete: endpoint(`${options.name}.delete`, "DELETE", route("/:id"), {
      input: { params: idParams },
      output: Schema.Struct({ success: Schema.Literal(true) }),
      errors,
      mcp: options.mcp,
    }),
    count: endpoint(`${options.name}.count`, "POST", route("/count"), {
      input: { payload: schemas.filterSchema },
      output: Schema.Struct({ count: int }),
      errors,
      mcp: options.mcp,
    }),
    exists: endpoint(`${options.name}.exists`, "POST", route("/exists"), {
      input: { payload: schemas.filterSchema },
      output: Schema.Struct({ exists: Schema.Boolean }),
      errors,
      mcp: options.mcp,
    }),
  };
  type Declared = Errors[number]["Type"];
  type I = Inputs<T, F, ID>;
  const bind = <
    C extends { readonly name: string },
    In,
    Out,
    E extends (typeof builtinErrors)[number]["Type"] | Declared,
    R,
  >(
    definition: C,
    handler: (input: In) => Effect.Effect<Out, E, R>,
  ) => {
    const invoke = (input: In) =>
      handler(input).pipe(Effect.withSpan(`brick.action.${definition.name}`));
    return Object.freeze({
      ...definition,
      handler: invoke,
      httpHandler: invoke,
    });
  };
  const implement = <Db, R = never>(implementation: {
    readonly store: Store<T, Db>;
    readonly access:
      | "public"
      | {
          readonly authorize: (
            args: Authorization<I>,
          ) => Effect.Effect<boolean, Declared, R>;
          readonly scope?: (args: {
            readonly operation: Operation;
          }) => Effect.Effect<SQL | undefined, Declared, R>;
        };
    readonly hooks?: HookShape<T, F, ID, Declared, R>;
    readonly scrub?: Scrubbers<T, F, Declared, R>;
  }) => {
    // Generate handlers only; the transport metadata above is reused unchanged.
    const handlers = crud({
      ...options,
      ...limits,
      operations: {},
      ...implementation,
    });
    return namedActions(
      options.name,
      {
        list: bind(all.list, (req: { readonly payload: I["list"] }) =>
          handlers.list.handler(req.payload),
        ),
        findOne: bind(all.findOne, (req: { readonly payload: I["findOne"] }) =>
          handlers.findOne.handler(req.payload),
        ),
        get: bind(all.get, (req: { readonly params: { readonly id: ID } }) =>
          handlers.get.handler({ id: req.params.id }),
        ),
        create: bind(all.create, (req: { readonly payload: I["create"] }) =>
          handlers.create.handler(req.payload),
        ),
        update: bind(
          all.update,
          (req: {
            readonly params: { readonly id: ID };
            readonly payload: I["update"]["data"];
          }) =>
            handlers.update.handler({ id: req.params.id, data: req.payload }),
        ),
        delete: bind(
          all.delete,
          (req: { readonly params: { readonly id: ID } }) =>
            handlers.delete.handler({ id: req.params.id }),
        ),
        count: bind(all.count, (req: { readonly payload: I["count"] }) =>
          handlers.count.handler(req.payload),
        ),
        exists: bind(all.exists, (req: { readonly payload: I["exists"] }) =>
          handlers.exists.handler(req.payload),
        ),
      },
      options.operations ?? ({} as O),
    );
  };
  return Object.freeze({
    actions: namedActions(options.name, all, options.operations ?? ({} as O)),
    implement,
  });
}
