import { Effect, Layer, ManagedRuntime } from "effect";
import { brick, type CreateServerOptions } from "./server";
import type {
  BrickApp,
  EndpointContext,
  EndpointDefinition,
} from "./endpoints";
import { getGlobalRegistry } from "./registry";
import {
  effectRuntimeKey,
  runEffectPromise,
  withApplicationRuntime,
} from "./effect-runtime";

export type EffectEndpointDefinition<R = never> = Omit<
  EndpointDefinition,
  "handler"
> & {
  handler: (ctx: EndpointContext) => Effect.Effect<unknown, unknown, R>;
};
export type EffectServerOptions<R = never, E = never> = Omit<
  CreateServerOptions,
  "endpoints"
> & {
  layer?: Layer.Layer<R, E>;
  endpoints?: EffectEndpointDefinition<R>[];
};
export type EffectBrickApp = BrickApp & {
  endpoint(definition: EffectEndpointDefinition<any>): void;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  initializeEffect: Effect.Effect<void, unknown>;
  disposeEffect: Effect.Effect<void, unknown>;
  handleEffect(request: Request): Effect.Effect<Response, unknown>;
  listenEffect(port: number): Effect.Effect<EffectBrickApp, unknown>;
};

/** One runtime owns the dependency layer across every service and transport. */
export function effectBrick<R = never, E = never>(
  options: EffectServerOptions<R, E> = {},
): EffectBrickApp {
  const services = options.services ?? getGlobalRegistry().list();
  const runtime = ManagedRuntime.make(options.layer ?? Layer.empty);
  let closed = false;
  let initializing: Promise<void> | undefined;
  let disposing: Promise<void> | undefined;
  const initialized: typeof services = [];
  const owner = { [effectRuntimeKey]: runtime };
  for (const service of services)
    Reflect.set(service, effectRuntimeKey, runtime);
  const adaptEndpoint = (
    definition: EffectEndpointDefinition<any>,
  ): EndpointDefinition => ({
    ...definition,
    handler: (ctx) =>
      runEffectPromise(
        Effect.suspend(() => {
          const result = definition.handler(ctx);
          return Effect.isEffect(result) ? result : Effect.succeed(result);
        }),
        owner,
        ctx.request.signal,
      ),
  });
  let app: BrickApp;
  try {
    app = brick({
      ...options,
      services,
      endpoints: options.endpoints?.map(adaptEndpoint),
    });
  } catch (error) {
    for (const service of services)
      if (Reflect.get(service, effectRuntimeKey) === runtime)
        Reflect.deleteProperty(service, effectRuntimeKey);
    for (const database of new Set(
      services.map(
        (service) => service.getDatabaseHandle?.() ?? service.options.database,
      ),
    )) {
      try {
        void Promise.resolve(database?.close?.()).catch(() => {});
      } catch {}
    }
    void runtime.dispose().catch(() => {});
    throw error;
  }
  const cleanup = (): Promise<void> =>
    (disposing ??= (async () => {
      closed = true;
      if (initializing) await initializing.catch(() => {});
      const errors: unknown[] = [];
      for (const service of [...initialized].reverse()) {
        try {
          await withApplicationRuntime(
            runtime,
            () => service.options.lifecycle?.onDestroy?.() ?? Promise.resolve(),
          );
        } catch (error) {
          errors.push(error);
        }
      }
      for (const database of new Set(
        services
          .map(
            (service) =>
              service.getDatabaseHandle?.() ?? service.options.database,
          )
          .filter((database) => database !== undefined),
      )) {
        try {
          await database.close?.();
        } catch (error) {
          errors.push(error);
        }
      }
      for (const service of services)
        if (Reflect.get(service, effectRuntimeKey) === runtime)
          Reflect.deleteProperty(service, effectRuntimeKey);
      try {
        await runtime.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length)
        throw new AggregateError(errors, "Brick app disposal failed");
    })());
  const ready = (): Promise<void> => {
    if (closed) return Promise.reject(new Error("Brick app has been disposed"));
    return (initializing ??= (async () => {
      try {
        await runtime.runtime();
        for (const service of services) {
          initialized.push(service);
          await withApplicationRuntime(
            runtime,
            () =>
              service.options.lifecycle?.onInit?.({ db: service.getDb() }) ??
              Promise.resolve(),
          );
        }
      } catch (error) {
        // Initialization's caller owns cleanup, avoiding waiting on itself.
        closed = true;
        for (const service of [...initialized].reverse()) {
          try {
            await withApplicationRuntime(
              runtime,
              () =>
                service.options.lifecycle?.onDestroy?.() ?? Promise.resolve(),
            );
          } catch {}
        }
        initialized.length = 0;
        for (const database of new Set(
          services
            .map(
              (service) =>
                service.getDatabaseHandle?.() ?? service.options.database,
            )
            .filter((database) => database !== undefined),
        )) {
          try {
            await database.close?.();
          } catch {}
        }
        await runtime.dispose();
        throw error;
      }
    })());
  };
  app.wrap(
    (fetch) =>
      async (request, ...rest) =>
        withApplicationRuntime(runtime, async () => {
          await ready();
          return fetch(request, ...rest);
        }),
  );
  const endpoint = app.endpoint.bind(app);
  const native: EffectBrickApp = Object.assign(app, {
    endpoint: (definition: EffectEndpointDefinition<any>) =>
      endpoint(adaptEndpoint(definition)),
    initialize: ready,
    dispose: async () => {
      try {
        if (app.server) await app.stop();
      } finally {
        await cleanup();
      }
    },
    initializeEffect: Effect.tryPromise({
      try: ready,
      catch: (error) => error,
    }),
    disposeEffect: Effect.tryPromise({
      try: () => native.dispose(),
      catch: (error) => error,
    }),
    handleEffect: (request: Request) =>
      Effect.tryPromise({
        try: () => app.handle(request),
        catch: (error) => error,
      }),
    listenEffect: (port: number) =>
      Effect.tryPromise({
        try: async () => {
          await ready();
          app.listen(port);
          return native;
        },
        catch: (error) => error,
      }),
  });
  app.setup(ready);
  app.cleanup(cleanup);
  return native;
}
