import { AsyncLocalStorage } from "node:async_hooks";
import { Cause, Context, Effect, Exit, type ManagedRuntime } from "effect";

const callbackRuntime = new AsyncLocalStorage<{
  runtime: Context.Context<any>;
  signal: AbortSignal;
}>();
const appRuntime = new AsyncLocalStorage<
  ManagedRuntime.ManagedRuntime<any, any>
>();

export function withApplicationRuntime<R, E, A>(
  runtime: ManagedRuntime.ManagedRuntime<R, E>,
  callback: () => A | PromiseLike<A>,
): Promise<A> {
  return appRuntime.run(runtime, async () => callback());
}

/** Promise-based database/plugin code inherits the native caller's dependency context. */
export function withEffectRuntime<A>(
  callback: () => A | PromiseLike<A>,
): Effect.Effect<A, unknown, any> {
  return Effect.flatMap(Effect.context<any>(), (runtime) =>
    Effect.tryPromise({
      try: async (signal) => callbackRuntime.run({ runtime, signal }, callback),
      catch: (error) => error,
    }),
  );
}

export const effectRuntimeKey = Symbol.for("brickkit.effect.runtime");

/** AbortSignal.any is missing on Node 18 before 18.17; combine manually there. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}
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
      ? anySignal([signal, inherited.signal])
      : inherited.signal
    : signal;
  const options = cancellation ? { signal: cancellation } : undefined;
  const exit = inherited
    ? await Effect.runPromiseExit(
        Effect.provide(provided, inherited.runtime),
        options,
      )
    : appContext
      ? await appContext.runPromiseExit(
          provided as Effect.Effect<A, E, any>,
          options,
        )
      : runtime
        ? await runtime.runPromiseExit(provided, options)
        : await Effect.runPromiseExit(
            provided as Effect.Effect<A, E, never>,
            options,
          );
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  return exit.value;
}
