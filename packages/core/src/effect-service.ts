import { Effect } from "effect";
import type { TSchema } from "@sinclair/typebox";
import type { BunSQLiteDatabase } from "./db/sqlite";
import { defineService, ServiceImpl } from "./service";
import {
  Resource,
  ResourceConfig,
  ResourceIdentity,
  ResourceTypeOptions,
} from "./types";
import { contextResolverKey, runEffectPromise } from "./effect-runtime";
import {
  defineEffectAction,
  defineEffectTool,
  type EffectAction,
  type EffectTool,
  type EffectActionConfigWithAuthorize,
  type EffectActionConfigWithoutAuthorize,
} from "./effect";
import type {
  ActionErrorDefinition,
  BaseContext,
  Service,
  ServiceOptions,
  LifecycleOptions,
  ToolOptions,
} from "./types";

type EffectRegistration<C extends BaseContext<any>, R> = {
  <
    I extends TSchema | undefined = undefined,
    O extends TSchema | undefined = undefined,
    Errors extends Record<string, ActionErrorDefinition> = Record<
      string,
      ActionErrorDefinition
    >,
    E = never,
    Q = never,
  >(
    config: EffectActionConfigWithAuthorize<I, O, Errors, C, E, Q>,
  ): EffectAction<I, O, Errors, C, E, R | Q>;
  <
    I extends TSchema | undefined = undefined,
    O extends TSchema | undefined = undefined,
    Errors extends Record<string, ActionErrorDefinition> = Record<
      string,
      ActionErrorDefinition
    >,
    E = never,
    Q = never,
  >(
    config: EffectActionConfigWithoutAuthorize<I, O, Errors, C, E, Q>,
  ): EffectAction<I, O, Errors, C, E, R | Q>;
  (
    action: EffectAction<any, any, any, C, any, any>,
  ): EffectService<any, any, R>;
};

type EffectToolRegistration<C extends BaseContext<any>, R> = {
  <
    I extends TSchema | undefined = undefined,
    O extends TSchema | undefined = undefined,
    Errors extends Record<string, ActionErrorDefinition> = Record<
      string,
      ActionErrorDefinition
    >,
    E = never,
    Q = never,
  >(
    config: EffectActionConfigWithAuthorize<I, O, Errors, C, E, Q> &
      ToolOptions,
  ): EffectTool<I, O, Errors, C, E, R | Q>;
  <
    I extends TSchema | undefined = undefined,
    O extends TSchema | undefined = undefined,
    Errors extends Record<string, ActionErrorDefinition> = Record<
      string,
      ActionErrorDefinition
    >,
    E = never,
    Q = never,
  >(
    config: EffectActionConfigWithoutAuthorize<I, O, Errors, C, E, Q> &
      ToolOptions,
  ): EffectTool<I, O, Errors, C, E, R | Q>;
  (action: EffectTool<any, any, any, C, any, any>): EffectService<any, any, R>;
};

export type EffectServiceOptions<
  C extends Record<string, any>,
  D,
  R = never,
> = Omit<ServiceOptions<C, D>, "context" | "lifecycle"> & {
  context?: (base: BaseContext<D>) => Effect.Effect<C, unknown, R>;
  lifecycle?: {
    onInit?: (
      ctx: Parameters<NonNullable<LifecycleOptions["onInit"]>>[0],
    ) => Effect.Effect<void, unknown, R>;
    onDestroy?: () => Effect.Effect<void, unknown, R>;
  };
};

export type EffectService<
  D = BunSQLiteDatabase<Record<string, unknown>>,
  C extends Record<string, any> = Record<string, any>,
  R = never,
> = Omit<Service<D, C>, "action" | "tool" | "resolveContext" | "resource"> & {
  action: EffectRegistration<BaseContext<D> & C, R> & Service<D, C>["action"];
  tool: EffectToolRegistration<BaseContext<D> & C, R> & Service<D, C>["tool"];
  resolveContext: Service<D, C>["resolveContext"];
  resolveContextEffect(
    ctx?: Partial<BaseContext<D> & C>,
  ): Effect.Effect<BaseContext<D> & C, unknown, R>;
  resource<
    TTable = any,
    const TOptions extends ResourceTypeOptions = ResourceTypeOptions,
  >(
    config: ResourceConfig<TTable, BaseContext<D> & C> &
      TOptions &
      Record<Exclude<keyof TOptions, keyof ResourceConfig>, never>,
  ): Resource<TTable, BaseContext<D> & C, ResourceIdentity<TTable, TOptions>>;
};

/** Native authoring shares the same registration host and metadata as Promise services. */
export function defineEffectService<
  D = BunSQLiteDatabase<Record<string, unknown>>,
  C extends Record<string, any> = Record<string, any>,
  R = never,
>(
  name: string,
  options: EffectServiceOptions<C, D, R> = {},
): EffectService<D, C, R> {
  const { context, lifecycle, ...declaration } = options;
  const service = defineService<D, C>(name, declaration) as ServiceImpl<D, C>;
  const resource = service.resource.bind(service);
  const effectService = service as unknown as EffectService<D, C, R>;
  effectService.resource = resource as EffectService<D, C, R>["resource"];
  if (context) {
    Object.defineProperty(service, contextResolverKey, { value: context });
    service.options.context = (base) =>
      runEffectPromise(
        Effect.suspend(() => context(base)),
        service,
        base.request.signal,
      );
  }
  if (lifecycle) {
    service.options.lifecycle = {
      onInit: lifecycle.onInit
        ? (ctx) => runEffectPromise(lifecycle.onInit!(ctx), service)
        : undefined,
      onDestroy: lifecycle.onDestroy
        ? () => runEffectPromise(lifecycle.onDestroy!(), service)
        : undefined,
    };
  }
  const registerAction = ServiceImpl.prototype.action;
  const registerTool = ServiceImpl.prototype.tool;
  service.action = ((config: any) => {
    if (typeof config === "function")
      return registerAction.call(service, config);
    const action = defineEffectAction(config);
    registerAction.call(service, action);
    return action;
  }) as typeof service.action;
  service.tool = ((config: any) => {
    if (typeof config === "function") return registerTool.call(service, config);
    const tool = defineEffectTool(config);
    registerTool.call(service, tool);
    return tool;
  }) as typeof service.tool;
  return effectService;
}
