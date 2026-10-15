import { Context, Effect, Exit, Fiber, Layer, Scope } from "effect";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiScalar,
  OpenApi,
} from "effect/http-api";
import {
  HttpEffect,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import type { Rpc } from "effect/rpc";
import type { Tool, McpServer } from "effect/ai";
import {
  rpcRoutes,
  mcpRoutes,
  type RpcRequirements,
  type McpRequirements,
} from "./transports";
import { route } from "./route";

export { action } from "./contracts";

export interface ActionConstraint {
  readonly rpc: Rpc.Any;
  readonly tool: Tool.Any;
  readonly mcp: boolean;
  /** False for tool-only actions: served over MCP/RPC but never mounted on HTTP. */
  readonly http: boolean;
  readonly endpoint: HttpApiEndpoint.Constraint;
  readonly method: string;
  readonly path: `/${string}`;
  readonly handler: (
    ...args: never[]
  ) => Effect.Effect<unknown, unknown, unknown>;
  readonly httpHandler: (
    ...args: never[]
  ) => Effect.Effect<unknown, unknown, unknown>;
}
type Endpoints<A extends Record<string, ActionConstraint>> =
  A[keyof A]["endpoint"];
export type Requirements<A extends Record<string, ActionConstraint>> = Exclude<
  Effect.Services<ReturnType<A[keyof A]["handler"]>>,
  HttpServerRequest.HttpServerRequest | Scope.Scope
>;
export type HttpRequirements<A extends Record<string, ActionConstraint>> = {
  [K in keyof A]:
    | ([unknown] extends [
        HttpApiEndpoint.ExcludeProvided<
          A[K]["endpoint"],
          | Effect.Services<ReturnType<A[K]["handler"]>>
          | HttpApiEndpoint.ServerServices<A[K]["endpoint"]>
        >,
      ]
        ? Effect.Services<ReturnType<A[K]["handler"]>>
        : HttpApiEndpoint.ExcludeProvided<
            A[K]["endpoint"],
            | Effect.Services<ReturnType<A[K]["handler"]>>
            | HttpApiEndpoint.ServerServices<A[K]["endpoint"]>
          >)
    | HttpApiEndpoint.Middleware<A[K]["endpoint"]>
    | HttpApiEndpoint.MiddlewareServices<A[K]["endpoint"]>;
}[keyof A];
export const service = <
  const N extends string,
  const A extends Record<string, ActionConstraint>,
>(
  name: N,
  options: { readonly actions: A },
) => {
  const { actions } = options;
  for (const [key, value] of Object.entries(actions))
    if (key !== value.endpoint.identifier)
      throw new Error("Action key and identifier differ");
  // Enumeration preserves the union of the exact endpoints; Object.values erases it.
  let group: HttpApiGroup.HttpApiGroup<N, HttpApiEndpoint.Constraint> =
    HttpApiGroup.make(name) as unknown as HttpApiGroup.HttpApiGroup<
      N,
      HttpApiEndpoint.Constraint
    >;
  // Tool-only actions (expose: "mcp") stay in the record for MCP/RPC and
  // in-process calls, but mount no HTTP route.
  for (const a of Object.values(actions))
    if (a.http) group = group.add(a.endpoint);
  return Object.freeze({
    name,
    actions: Object.freeze({ ...actions }),
    group: group as HttpApiGroup.HttpApiGroup<N, Endpoints<A>>,
  });
};
export function compileService<
  const N extends string,
  const A extends Record<string, ActionConstraint>,
>(s: ReturnType<typeof service<N, A>>) {
  const api = HttpApi.make("brick").add(s.group);
  // Native generics cannot reduce Extract<Group<N>, {identifier: N}> with open N.
  // This internal view erases only the enumerated correlation; public API retains it.
  const runtimeApi = api as unknown as HttpApi.HttpApi<
    "brick",
    HttpApiGroup.HttpApiGroup<string, HttpApiEndpoint.Constraint>
  >;
  type RuntimeGroup = HttpApiGroup.HttpApiGroup<
    string,
    HttpApiEndpoint.Constraint
  >;
  type Built = Effect.Effect<
    HttpApiBuilder.Handlers<
      never,
      Record<string, HttpApiEndpoint.Constraint>,
      string
    >,
    never,
    HttpRequirements<A>
  >;
  const implementation = HttpApiBuilder.group<
    "brick",
    RuntimeGroup,
    string,
    Built
  >(runtimeApi, String(s.name), (h) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<HttpRequirements<A>>();
      const handlers: Record<
        string,
        HttpApiEndpoint.Handler<HttpApiEndpoint.Constraint, unknown, never>
      > = {};
      for (const a of Object.values(s.actions)) {
        if (!a.http) continue;
        handlers[a.endpoint.identifier] = (input) =>
          Effect.flatMap(Effect.context<never>(), (requestContext) =>
            a
              .httpHandler(input as never)
              .pipe(
                Effect.provideContext(
                  Context.merge(
                    context,
                    requestContext,
                  ) as Context.Context<unknown>,
                ),
              ),
          );
      }
      return h.handleAll(handlers);
    }),
  );
  const checkedImplementation = implementation as Layer.Layer<
    HttpApiGroup.Service<"brick", N>,
    never,
    HttpRequirements<A>
  >;
  return Object.freeze({ api, implementation: checkedImplementation });
}
export function layer<
  const N extends string,
  const A extends Record<string, ActionConstraint>,
>(s: ReturnType<typeof service<N, A>>) {
  const compiled = compileService(s);
  return HttpApiBuilder.layer(compiled.api).pipe(
    Layer.provide(compiled.implementation),
    Layer.provide(HttpServer.layerServices),
  );
}
export const mount = <A, E>(
  routes: Layer.Layer<A, E, HttpRouter.HttpRouter>,
) => {
  let handler: ((request: Request) => Promise<Response>) | undefined;
  let startup: Promise<void> | undefined;
  let startupFiber: Fiber.Fiber<void, E> | undefined;
  let closing: Promise<void> | undefined;
  const scope = Scope.makeUnsafe();
  let disposed = false;
  const active = new Map<
    AbortSignal,
    {
      readonly controller: AbortController;
      readonly done: Promise<void>;
      readonly complete: () => void;
    }
  >();
  const ready = (): Promise<void> => {
    if (disposed)
      return Promise.reject(new Error("Brick application is disposed"));
    if (!startup) {
      // Metadata inspection is side-effect free. The app owns and can interrupt
      // the startup fiber, including an acquisition which has not completed.
      startupFiber = Effect.runFork(
        Effect.gen(function* () {
          const context = yield* Layer.buildWithScope(
            Layer.provideMerge(routes, HttpRouter.layer),
            scope,
          );
          const router = Context.get(context, HttpRouter.HttpRouter);
          const tracked = Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            if (request.source instanceof Request) {
              const entry = active.get(request.source.signal);
              if (entry)
                yield* Effect.addFinalizer(() => Effect.sync(entry.complete));
            }
            return yield* router.asHttpEffect();
          });
          handler = HttpEffect.toWebHandlerWith<
            A | HttpRouter.HttpRouter,
            Scope.Scope | HttpServerRequest.HttpServerRequest,
            never
          >(context)(tracked);
        }),
      );
      startup = Effect.runPromise(Fiber.join(startupFiber));
      startup.catch(() => {});
    }
    return startup;
  };
  const fetch = async (request: Request): Promise<Response> => {
    await ready();
    if (disposed || !handler) throw new Error("Brick application is disposed");
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    const internal = new Request(request, { signal: controller.signal });
    let resolve!: () => void;
    const done = new Promise<void>((yes) => {
      resolve = yes;
    });
    const complete = () => {
      request.signal.removeEventListener("abort", abort);
      active.delete(internal.signal);
      resolve();
    };
    active.set(internal.signal, { controller, done, complete });
    try {
      return await handler(internal);
    } catch (error) {
      complete();
      throw error;
    }
  };
  const dispose = (): Promise<void> => {
    disposed = true;
    closing ??= (async () => {
      if (startupFiber) await Effect.runPromise(Fiber.interrupt(startupFiber));
      const requests = [...active.values()];
      for (const request of requests) request.controller.abort();
      await Promise.all(requests.map((request) => request.done));
      await Effect.runPromise(Scope.close(scope, Exit.void));
    })();
    return closing;
  };
  return Object.freeze({ fetch, ready, dispose });
};

export interface ServiceConstraint {
  readonly name: string;
  readonly actions: Record<string, ActionConstraint>;
  readonly group: HttpApiGroup.Constraint;
}
type AppGroups<S extends readonly ServiceConstraint[]> = S[number]["group"];
type AppRequirements<S extends readonly ServiceConstraint[]> =
  S[number] extends infer V
    ? V extends ServiceConstraint
      ? HttpRequirements<V["actions"]>
      : never
    : never;

export interface Transports {
  readonly rpc?: { readonly path: `/${string}` };
  readonly mcp?: Parameters<typeof McpServer.layerHttp>[0];
}
type TransportRequirements<
  S extends readonly ServiceConstraint[],
  T,
> = S[number] extends infer V
  ? V extends ServiceConstraint
    ?
        | (T extends { readonly rpc: object }
            ? Requirements<V["actions"]> | RpcRequirements<V["actions"]>
            : never)
        | (T extends { readonly mcp: object }
            ? Requirements<V["actions"]> | McpRequirements<V["actions"]>
            : never)
    : never
  : never;

/** Compose closed applications. Handler and schema requirements must be supplied. */
export function app<
  const S extends readonly ServiceConstraint[],
  E,
  const T extends Transports = {},
  RoutesA = never,
  RoutesE = never,
  RoutesR = never,
>(options: {
  readonly services: S;
  readonly layer: Layer.Layer<
    | AppRequirements<S>
    | TransportRequirements<S, T>
    | Exclude<RoutesR, HttpRouter.HttpRouter>,
    E,
    never
  >;
  readonly transports?: T;
  readonly routes?: Layer.Layer<RoutesA, RoutesE, RoutesR>;
  readonly docs?: { readonly path: `/${string}` };
  readonly client?: { readonly module: string; readonly exportName?: string };
}) {
  let api: HttpApi.HttpApi<"brick", HttpApiGroup.Constraint> = HttpApi.make(
    "brick",
  ) as unknown as HttpApi.HttpApi<"brick", HttpApiGroup.Constraint>;
  let implementation: Layer.Layer<never, never, unknown> = Layer.empty;
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const s of options.services) {
    if (names.has(s.name)) throw new Error(`Duplicate service: ${s.name}`);
    names.add(s.name);
    for (const a of Object.values(s.actions)) {
      if (!a.http) continue;
      const route = `${a.method} ${a.path}`;
      if (paths.has(route)) throw new Error(`Duplicate route: ${route}`);
      paths.add(route);
    }
    // All groups are enumerated once; these casts retain that exact tuple union.
    api = api.add(s.group);
    const compiled = compileService(
      s as ReturnType<typeof service<string, Record<string, ActionConstraint>>>,
    );
    implementation = Layer.merge(implementation, compiled.implementation);
  }
  const typedApi = api as HttpApi.HttpApi<"brick", AppGroups<S>>;
  const typedImplementation = implementation as Layer.Layer<
    HttpApiGroup.Service<"brick", S[number]["name"]>,
    never,
    AppRequirements<S>
  >;
  const http = HttpApiBuilder.layer(typedApi).pipe(
    Layer.provide(typedImplementation),
  );
  const actions: Record<string, ActionConstraint> = {};
  if (options.transports?.rpc || options.transports?.mcp) {
    for (const s of options.services)
      for (const a of Object.values(s.actions)) {
        if (Object.hasOwn(actions, a.rpc._tag))
          throw new Error(`Duplicate transport action: ${a.rpc._tag}`);
        actions[a.rpc._tag] = a;
      }
  }
  const rpc = options.transports?.rpc
    ? rpcRoutes(actions, options.transports.rpc)
    : Layer.empty;
  const mcp = options.transports?.mcp
    ? mcpRoutes(actions, options.transports.mcp)
    : Layer.empty;
  // Built-in diagnostics. Registered before user routes so the framework
  // endpoints win on collision, matching the pre-Effect server behavior.
  const architecture = {
    version: "1.0.0",
    services: options.services.map((s) => ({
      name: s.name,
      actions: Object.values(s.actions).map((a) => ({
        name: a.endpoint.identifier,
        method: a.method,
        path: a.path,
        mcp: a.mcp,
        http: a.http,
      })),
    })),
  };
  const builtin = Layer.mergeAll(
    route(
      "GET",
      "/_health",
      Effect.succeed(
        HttpServerResponse.jsonUnsafe({
          status: "ok",
          uptime: process.uptime(),
          timestamp: Date.now(),
        }),
      ),
    ),
    route(
      "GET",
      "/_brick/services",
      Effect.succeed(HttpServerResponse.jsonUnsafe(architecture)),
    ),
  );
  // Each protocol uses the same dependency graph and memo map, so a scoped pool
  // is acquired once and released by the application's owner.
  const routes = Layer.mergeAll(
    http,
    rpc,
    mcp,
    builtin,
    options.routes ?? Layer.empty,
  ).pipe(Layer.provide(options.layer), Layer.provide(HttpServer.layerServices));
  const withDocs = options.docs
    ? Layer.merge(routes, HttpApiScalar.layer(typedApi, options.docs))
    : routes;
  // Native group lookup does not reduce open tuple unions. All implementations
  // above match the validated groups and the input layer closes their services.
  const mounted = mount(
    withDocs as Layer.Layer<
      never,
      E | RoutesE | Layer.Error<ReturnType<typeof mcpRoutes>>,
      HttpRouter.HttpRouter
    >,
  );
  return Object.freeze({
    ...mounted,
    kind: "brick-native-app" as const,
    services: Object.freeze([...options.services]),
    client: options.client && Object.freeze({ ...options.client }),
    layer: withDocs as Layer.Layer<
      never,
      E | RoutesE | Layer.Error<ReturnType<typeof mcpRoutes>>,
      HttpRouter.HttpRouter
    >,
    api: typedApi,
    openApi: () => OpenApi.fromApi(typedApi),
  });
}
