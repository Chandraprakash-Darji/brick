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

/** Services can be shared across apps; the newest live binding wins for direct calls. */
const runtimeBindings = new WeakMap<object, unknown[]>();

function bindRuntime(service: object, runtime: unknown): void {
  const stack = runtimeBindings.get(service) ?? [];
  stack.push(runtime);
  runtimeBindings.set(service, stack);
  Reflect.set(service, effectRuntimeKey, runtime);
}

function unbindRuntime(service: object, runtime: unknown): void {
  const stack = (runtimeBindings.get(service) ?? []).filter(
    (bound) => bound !== runtime,
  );
  if (stack.length) {
    runtimeBindings.set(service, stack);
    Reflect.set(service, effectRuntimeKey, stack[stack.length - 1]);
  } else {
    runtimeBindings.delete(service);
    if (Reflect.get(service, effectRuntimeKey) === runtime)
      Reflect.deleteProperty(service, effectRuntimeKey);
  }
}

/** Database handles are usually shared singletons; close on last release. */
const handleUsers = new WeakMap<object, number>();

function liveDatabaseHandles(services: readonly object[]): Set<object> {
  const handles = new Set<object>();
  for (const service of services) {
    const handle =
      (
        service as { getDatabaseHandle?: () => unknown }
      ).getDatabaseHandle?.() ??
      (service as { options?: { database?: unknown } }).options?.database;
    if (handle !== null && handle !== undefined) handles.add(handle as object);
  }
  return handles;
}

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
  for (const service of services) bindRuntime(service, runtime);
  const releasedHandles = new Set<object>();
  const releaseHandle = async (
    handle: object,
    errors?: unknown[],
  ): Promise<void> => {
    if (releasedHandles.has(handle)) return;
    releasedHandles.add(handle);
    const remaining = (handleUsers.get(handle) ?? 1) - 1;
    if (remaining > 0) {
      handleUsers.set(handle, remaining);
      return;
    }
    handleUsers.delete(handle);
    try {
      await (handle as { close?: () => unknown }).close?.();
    } catch (error) {
      errors?.push(error);
    }
  };
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
    // This app never acquired anything: unbind runtimes without closing
    // handles owned by other (possibly still running) apps.
    for (const service of services) unbindRuntime(service, runtime);
    void runtime.dispose().catch(() => {});
    throw error;
  }
  // Retain the acquired set: setDb can swap the live handle, and disposal
  // releases exactly what this app acquired. A swapped-in handle belongs to
  // whoever installed it, so releasing it here could close another live app.
  const acquiredHandles = liveDatabaseHandles(services);
  for (const handle of acquiredHandles)
    handleUsers.set(handle, (handleUsers.get(handle) ?? 0) + 1);
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
      for (const database of acquiredHandles)
        await releaseHandle(database, errors);
      for (const service of services) unbindRuntime(service, runtime);
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
        for (const database of acquiredHandles) await releaseHandle(database);
        for (const service of services) unbindRuntime(service, runtime);
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
