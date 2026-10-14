import { AsyncLocalStorage } from "node:async_hooks";
import { Cause, Effect, Exit, Runtime, type ManagedRuntime } from "effect";

const callbackRuntime = new AsyncLocalStorage<{
  runtime: Runtime.Runtime<any>;
  signal: AbortSignal;
}>();
const appRuntime = new AsyncLocalStorage<Runtime.Runtime<any>>();

export function withApplicationRuntime<R, A>(
  runtime: ManagedRuntime.ManagedRuntime<R, any>,
  callback: () => A | PromiseLike<A>,
): Promise<A> {
  return runtime
    .runtime()
    .then((activeRuntime) =>
      appRuntime.run(activeRuntime, async () => callback()),
    );
}

/** Promise-based database/plugin code inherits the native caller's dependency context. */
export function withEffectRuntime<A>(
  callback: () => A | PromiseLike<A>,
): Effect.Effect<A, unknown, any> {
  return Effect.flatMap(Effect.runtime<any>(), (runtime) =>
    Effect.tryPromise({
      try: async (signal) => callbackRuntime.run({ runtime, signal }, callback),
      catch: (error) => error,
    }),
  );
}

export const effectRuntimeKey = Symbol.for("brickkit.effect.runtime");
export const contextResolverKey = Symbol.for("brickkit.effect.context");
export const effectExecutionKey = Symbol.for("brickkit.effect.execute");
export const effectAuthorizationKey = Symbol.for("brickkit.effect.authorize");

export function normalizeEffectError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(String(error), { cause: error });
}

/** The HTTP and Promise boundary preserves original failures and shares the app runtime. */
export async function runEffectPromise<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  owner?: object,
  signal?: AbortSignal,
): Promise<A> {
  const appContext = appRuntime.getStore();
  const runtime: ManagedRuntime.ManagedRuntime<R, unknown> | undefined =
    appContext ? undefined : owner && Reflect.get(owner, effectRuntimeKey);
  const provided = effect;
  const inherited = callbackRuntime.getStore();
  const cancellation = inherited
    ? signal
      ? AbortSignal.any([signal, inherited.signal])
      : inherited.signal
    : signal;
  const options = cancellation ? { signal: cancellation } : undefined;
  const exit = inherited
    ? await Runtime.runPromiseExit(inherited.runtime)(provided, options)
    : appContext
      ? await Runtime.runPromiseExit(appContext)(
          provided as Effect.Effect<A, E>,
          options,
        )
      : runtime
        ? await runtime.runPromiseExit(provided, options)
        : await Effect.runPromiseExit(provided as Effect.Effect<A, E>, options);
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  return exit.value;
}
