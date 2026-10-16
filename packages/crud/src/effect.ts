import { Effect } from "effect";
import { runEffectPromise } from "@brickkit/core/effect";
import type { Service, ResourcePlugin, ActionContext } from "@brickkit/core";
import type { Table, Column, GetColumnData } from "drizzle-orm";
import { crud as defineCrud } from "./index";
import type {
  CrudOptions,
  CrudPlugin,
  CrudAPI,
  FieldPolicy,
  Operations,
} from "./types";

type CallbackRequirement<F> = F extends (
  ...args: any[]
) => Effect.Effect<any, any, infer R>
  ? R
  : never;
type CallbackRequirements<C> = C extends object
  ? {
      [K in keyof C]-?: CallbackRequirement<C[K]>;
    }[keyof C]
  : never;
type FieldRequirements<F> = {
  [K in keyof F]: F[K] extends { scrub: infer S }
    ? CallbackRequirement<S>
    : never;
}[keyof F];

type EffectCrudAPI<A, R> = {
  [K in keyof A]: A[K] &
    (A[K] extends { execute: (...args: infer P) => infer V }
      ? {
          executeEffect: (...args: P) => Effect.Effect<Awaited<V>, unknown, R>;
        }
      : {});
};
interface EffectCrudTypes<F, O, R> {
  readonly table: unknown;
  readonly context: unknown;
  readonly resource: unknown;
  readonly api: this["table"] extends Table
    ? EffectCrudAPI<
        CrudAPI<
          this["table"],
          this["context"],
          F,
          O,
          this["resource"] extends { config: { id: infer I extends Column } }
            ? GetColumnData<I, "raw">
            : this["table"]["$inferSelect"][keyof this["table"]["$inferSelect"]]
        >,
        R
      >
    : {};
}
export type EffectCrudPlugin<
  F extends EffectFields,
  O extends Operations,
  R = never,
> = Omit<CrudPlugin<PromiseFields<F>, O>, "types"> & {
  readonly types: EffectCrudTypes<PromiseFields<F>, O, R>;
};

type EffectCallback<F> = F extends (...args: infer P) => infer A
  ? (...args: P) => Effect.Effect<Awaited<A>, unknown, any>
  : never;
type EffectHooksFor<C extends ActionContext> = {
  beforeCreate?: (args: {
    data: Record<string, unknown>;
    ctx: C;
    error: Parameters<
      NonNullable<NonNullable<CrudOptions["hooks"]>["beforeCreate"]>
    >[0]["error"];
  }) => Effect.Effect<void, unknown, any>;
  beforeUpdate?: (args: {
    id: unknown;
    data: Record<string, unknown>;
    ctx: C;
    error: Parameters<
      NonNullable<NonNullable<CrudOptions["hooks"]>["beforeUpdate"]>
    >[0]["error"];
  }) => Effect.Effect<void, unknown, any>;
  afterCreate?: (args: {
    row: Record<string, unknown>;
    ctx: C;
    error: Parameters<
      NonNullable<NonNullable<CrudOptions["hooks"]>["afterCreate"]>
    >[0]["error"];
  }) => Effect.Effect<void, unknown, any>;
  afterUpdate?: (args: {
    id: unknown;
    row: Record<string, unknown>;
    ctx: C;
    error: Parameters<
      NonNullable<NonNullable<CrudOptions["hooks"]>["afterUpdate"]>
    >[0]["error"];
  }) => Effect.Effect<void, unknown, any>;
  beforeDelete?: (args: {
    id: unknown;
    ctx: C;
    error: Parameters<
      NonNullable<NonNullable<CrudOptions["hooks"]>["beforeDelete"]>
    >[0]["error"];
  }) => Effect.Effect<void, unknown, any>;
  afterDelete?: (args: {
    id: unknown;
    ctx: C;
    error: Parameters<
      NonNullable<NonNullable<CrudOptions["hooks"]>["afterDelete"]>
    >[0]["error"];
  }) => Effect.Effect<void, unknown, any>;
};
type EffectPolicy<P extends FieldPolicy> = P extends unknown
  ? Omit<P, "scrub"> & {
      scrub?: EffectCallback<NonNullable<P["scrub"]>>;
    }
  : never;
export type EffectFieldPolicy = EffectPolicy<FieldPolicy>;
export type EffectFields = Readonly<Record<string, EffectFieldPolicy>>;
type PromisePolicy<P extends EffectFieldPolicy> = P extends unknown
  ? Omit<P, "scrub"> &
      (P extends {
        scrub: (...args: infer P) => Effect.Effect<infer A, any, any>;
      }
        ? { scrub: (...args: P) => Promise<A> }
        : {})
  : never;
type PromiseFields<F extends EffectFields> = {
  [K in keyof F]: PromisePolicy<F[K]>;
};
export type EffectCrudOptions<
  F extends EffectFields = EffectFields,
  O extends Operations = Operations,
> = Omit<CrudOptions<PromiseFields<F>, O>, "fields" | "access" | "hooks"> & {
  fields: F;
  access:
    | "public"
    | {
        authorize?: EffectCallback<
          NonNullable<Exclude<CrudOptions["access"], string>["authorize"]>
        >;
        scope?: EffectCallback<
          NonNullable<Exclude<CrudOptions["access"], string>["scope"]>
        >;
      };
  hooks?: EffectHooksFor<ActionContext>;
};

function callback<A extends unknown[], B>(
  fn: (...args: A) => Effect.Effect<B, unknown, any>,
  service: Service<any, any>,
): (...args: A) => Promise<B> {
  return (...args) => {
    const context = args[0];
    const signal =
      context &&
      typeof context === "object" &&
      "ctx" in context &&
      context.ctx &&
      typeof context.ctx === "object" &&
      "request" in context.ctx &&
      context.ctx.request instanceof Request
        ? context.ctx.request.signal
        : undefined;
    return runEffectPromise(
      Effect.suspend(() => fn(...args)),
      service,
      signal,
    );
  };
}

/** Declarations remain synchronous; runtime policy and hook Effects use the host's runtime. */
export function crud<
  const F extends EffectFields,
  const O extends Operations = {},
  const A extends EffectCrudOptions<F, O>["access"] = EffectCrudOptions<
    F,
    O
  >["access"],
  const H extends EffectHooksFor<ActionContext> = {},
>(
  options: Omit<EffectCrudOptions<F, O>, "access" | "hooks"> & {
    access: A;
    hooks?: H & EffectHooksFor<ActionContext>;
  },
): EffectCrudPlugin<
  F,
  O,
  FieldRequirements<F> | CallbackRequirements<A> | CallbackRequirements<H>
> {
  // Reuse the standard descriptor protocol and install the concrete CRUD declaration
  // only after the host service is available, so every callback has the same runtime.
  const descriptor = defineCrud({
    ...options,
    fields: {},
    access: "public",
    hooks: undefined,
  });
  const setup: ResourcePlugin<any, any, object>["setup"] = (context) => {
    const fields = Object.fromEntries(
      Object.entries(options.fields).map(([name, policy]) => [
        name,
        {
          ...policy,
          ...(policy.scrub
            ? { scrub: callback(policy.scrub, context.service) }
            : {}),
        },
      ]),
    );
    const access =
      options.access === "public"
        ? "public"
        : {
            ...(options.access.authorize
              ? {
                  authorize: callback(
                    options.access.authorize,
                    context.service,
                  ),
                }
              : {}),
            ...(options.access.scope
              ? { scope: callback(options.access.scope, context.service) }
              : {}),
          };
    const hooks = options.hooks && {
      ...(options.hooks.beforeCreate
        ? {
            beforeCreate: callback(options.hooks.beforeCreate, context.service),
          }
        : {}),
      ...(options.hooks.afterCreate
        ? { afterCreate: callback(options.hooks.afterCreate, context.service) }
        : {}),
      ...(options.hooks.beforeUpdate
        ? {
            beforeUpdate: callback(options.hooks.beforeUpdate, context.service),
          }
        : {}),
      ...(options.hooks.afterUpdate
        ? { afterUpdate: callback(options.hooks.afterUpdate, context.service) }
        : {}),
      ...(options.hooks.beforeDelete
        ? {
            beforeDelete: callback(options.hooks.beforeDelete, context.service),
          }
        : {}),
      ...(options.hooks.afterDelete
        ? { afterDelete: callback(options.hooks.afterDelete, context.service) }
        : {}),
    };
    return defineCrud({ ...options, fields, access, hooks } as any).setup(
      context,
    );
  };
  return { ...descriptor, setup } as EffectCrudPlugin<
    F,
    O,
    FieldRequirements<F> | CallbackRequirements<A> | CallbackRequirements<H>
  >;
}

export { crud as defineEffectCrud };
export type { CrudAPI, Operation, Operations, FilterOperator } from "./types";
