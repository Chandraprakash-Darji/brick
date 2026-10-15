import { Context, Effect, Layer, Scope } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";
import { Rpc, RpcGroup, RpcSerialization, RpcServer } from "effect/rpc";
import { McpServer, Tool, Toolkit } from "effect/ai";
import type { ActionConstraint, Requirements } from "./kernel";

export interface TransportAction extends ActionConstraint {
  readonly rpc: Rpc.Any;
  readonly tool: Tool.Any;
  readonly mcp: boolean;
}
export type RpcRequirements<A extends Record<string, TransportAction>> =
  Exclude<
    [unknown] extends [
      Rpc.ServicesServer<A[keyof A]["rpc"]> | Rpc.Middleware<A[keyof A]["rpc"]>,
    ]
      ? never
      :
          | Rpc.ServicesServer<A[keyof A]["rpc"]>
          | Rpc.Middleware<A[keyof A]["rpc"]>,
    Scope.Scope | HttpServerRequest.HttpServerRequest
  >;
export type McpRequirements<A extends Record<string, TransportAction>> =
  Exclude<
    [unknown] extends [Tool.HandlerServices<A[keyof A]["tool"]>]
      ? never
      : Tool.HandlerServices<A[keyof A]["tool"]>,
    Scope.Scope | HttpServerRequest.HttpServerRequest
  >;

/** The same schema-only metadata can construct groups on both sides of the wire. */
export const rpcGroup = <
  const A extends Record<string, { readonly rpc: Rpc.Any }>,
>(
  actions: A,
): RpcGroup.RpcGroup<A[keyof A]["rpc"]> =>
  RpcGroup.make(...Object.values(actions).map((action) => action.rpc));

export function rpcRoutes<const A extends Record<string, TransportAction>>(
  actions: A,
  options: { readonly path: `/${string}` },
): Layer.Layer<
  never,
  never,
  HttpRouter.HttpRouter | Requirements<A> | RpcRequirements<A>
> {
  const group = rpcGroup(actions);
  const build = Effect.gen(function* () {
    const context = yield* Effect.context<
      Requirements<A> | RpcRequirements<A>
    >();
    return Object.fromEntries(
      Object.values(actions).map((action) => [
        action.rpc._tag,
        (input: never) =>
          Effect.flatMap(Effect.context<never>(), (current) =>
            action
              .handler(input)
              .pipe(
                Effect.provideContext(
                  Context.merge(context, current) as Context.Context<unknown>,
                ),
              ),
          ),
      ]),
    ) as unknown as RpcGroup.HandlersFrom<A[keyof A]["rpc"]>;
  });
  return RpcServer.layerHttp({
    group,
    path: options.path,
    protocol: "http",
    disableFatalDefects: true,
  }).pipe(
    Layer.provide(group.toLayer(build)),
    Layer.provide(RpcSerialization.layerJson),
  ) as Layer.Layer<
    never,
    never,
    HttpRouter.HttpRouter | Requirements<A> | RpcRequirements<A>
  >;
}

export function mcpRoutes<const A extends Record<string, TransportAction>>(
  actions: A,
  options: Parameters<typeof McpServer.layerHttp>[0],
): Layer.Layer<
  never,
  Layer.Error<ReturnType<typeof McpServer.layerHttp>>,
  HttpRouter.HttpRouter | Requirements<A> | McpRequirements<A>
> {
  const exposed = Object.values(actions).filter((action) => action.mcp);
  const tools = Toolkit.make(...exposed.map((action) => action.tool));
  const build = Effect.gen(function* () {
    const context = yield* Effect.context<
      Requirements<A> | McpRequirements<A>
    >();
    return Object.fromEntries(
      exposed.map((action) => [
        action.tool.name,
        (input: never) =>
          Effect.flatMap(Effect.context<never>(), (current) =>
            action
              .handler(input)
              .pipe(
                Effect.provideContext(
                  Context.merge(context, current) as Context.Context<unknown>,
                ),
              ),
          ),
      ]),
    ) as Toolkit.HandlersFrom<Toolkit.Tools<typeof tools>>;
  });
  return Layer.effectDiscard(McpServer.registerToolkit(tools)).pipe(
    Layer.provide(tools.toLayer(build)),
    Layer.provide(McpServer.layerHttp(options)),
  ) as Layer.Layer<
    never,
    Layer.Error<ReturnType<typeof McpServer.layerHttp>>,
    HttpRouter.HttpRouter | Requirements<A> | McpRequirements<A>
  >;
}
