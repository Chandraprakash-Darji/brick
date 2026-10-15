import { Effect } from "effect";
import type { TSchema } from "@sinclair/typebox";
import {
  defineServicePlugin,
  defineResourcePlugin,
  type PluginRouteRegistrar,
  type PluginEndpointContext,
  type ServicePluginContext,
  type ResourcePluginContext,
  type ServicePlugin,
  type ResourcePlugin,
} from "./plugin";
import type {
  Service,
  Resource,
  ActionContext,
  ActionErrorDefinition,
} from "./types";
import {
  adaptEffectActionConfig,
  type EffectAction,
  type EffectActionConfigWithAuthorize,
  type EffectActionConfigWithoutAuthorize,
} from "./effect";
import { runEffectPromise } from "./effect-runtime";

type RouteOptions = Pick<
  Parameters<PluginRouteRegistrar["action"]>[0],
  "path" | "method" | "scope"
>;

export interface EffectPluginRouteRegistrar<
  C extends ActionContext = ActionContext,
> {
  action<
    I extends TSchema | undefined = undefined,
    O extends TSchema | undefined = undefined,
    Errors extends Record<string, ActionErrorDefinition> = Record<
      string,
      ActionErrorDefinition
    >,
    E = never,
    R = never,
  >(
    config: EffectActionConfigWithAuthorize<I, O, Errors, C, E, R> &
      RouteOptions,
  ): EffectAction<I, O, Errors, C, E, R>;
  action<
    I extends TSchema | undefined = undefined,
    O extends TSchema | undefined = undefined,
    Errors extends Record<string, ActionErrorDefinition> = Record<
      string,
      ActionErrorDefinition
    >,
    E = never,
    R = never,
  >(
    config: EffectActionConfigWithoutAuthorize<I, O, Errors, C, E, R> &
      RouteOptions,
  ): EffectAction<I, O, Errors, C, E, R>;
  endpoint(
    config: Omit<
      Parameters<PluginRouteRegistrar<C>["endpoint"]>[0],
      "handler"
    > & {
      handler: (
        context: PluginEndpointContext<C>,
      ) => Effect.Effect<unknown, unknown, any>;
    },
  ): void;
}

type EffectServicePluginContext<S extends Service<any, any>> = Omit<
  ServicePluginContext<S>,
  "routes"
> & {
  routes: EffectPluginRouteRegistrar<
    ServicePluginContext<S>["routes"] extends PluginRouteRegistrar<infer C, any>
      ? C
      : never
  >;
};

type EffectResourcePluginContext<
  S extends Service<any, any>,
  R extends Resource<any, any, any>,
> = Omit<ResourcePluginContext<S, R>, "routes"> & {
  routes: EffectPluginRouteRegistrar<
    ResourcePluginContext<S, R>["routes"] extends PluginRouteRegistrar<
      infer C,
      any
    >
      ? C
      : never
  >;
};

function effectRoutes<C extends ActionContext>(
  routes: PluginRouteRegistrar<C>,
  service: Service<any, any>,
): EffectPluginRouteRegistrar<C> {
  return {
    action: (config: any): any =>
      routes.action(adaptEffectActionConfig(config, service)),
    endpoint: (config) =>
      routes.endpoint({
        ...config,
        handler: (context) =>
          runEffectPromise(
            Effect.suspend(() => config.handler(context)),
            service,
            context.request.signal,
          ),
      }),
  };
}

export function defineEffectServicePlugin<
  S extends Service<any, any> = Service<any, any>,
  A = unknown,
>(
  definition: Pick<ServicePlugin<S, A>, "name" | "routes"> & {
    setup: (
      context: EffectServicePluginContext<S>,
    ) => A & (A extends PromiseLike<unknown> ? never : unknown);
  },
): ServicePlugin<S, A> {
  return defineServicePlugin({
    ...definition,
    setup: (context) =>
      definition.setup({
        ...context,
        routes: effectRoutes(context.routes, context.service),
      }),
  });
}

export function defineEffectResourcePlugin<
  S extends Service<any, any> = Service<any, any>,
  R extends Resource<any, any, any> = Resource<any, any, any>,
  A extends object = object,
>(
  definition: Pick<ResourcePlugin<S, R, A>, "name" | "routes"> & {
    setup: (
      context: EffectResourcePluginContext<S, R>,
    ) => A & (A extends PromiseLike<unknown> ? never : unknown);
  },
): ResourcePlugin<S, R, A> {
  return defineResourcePlugin({
    ...definition,
    setup: (context) =>
      definition.setup({
        ...context,
        routes: effectRoutes(context.routes, context.service),
      }),
  });
}
