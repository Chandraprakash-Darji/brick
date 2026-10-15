import { Context, Effect, Layer, Scope } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";

type Static<R> = Exclude<
  R,
  Scope.Scope | HttpServerRequest.HttpServerRequest | HttpRouter.RouteContext
>;

/** Capture application services once, and use request services at invocation. */
export function route<E, R>(
  method: Parameters<typeof HttpRouter.add>[0],
  path: `/${string}`,
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
): Layer.Layer<never, never, HttpRouter.HttpRouter | Static<R>> {
  // Native Request markers cannot reduce Exclude<R, R> while R is open.
  // All application services are captured above the request; raw route failures
  // are handled by the native HTTP runtime rather than failing layer startup.
  return Layer.unwrap(
    Effect.gen(function* () {
      const context = yield* Effect.context<Static<R>>();
      return HttpRouter.add(
        method,
        path,
        Effect.flatMap(Effect.context<never>(), (current) =>
          handler.pipe(
            Effect.provideContext(
              Context.merge(context, current) as Context.Context<R>,
            ),
          ),
        ),
      );
    }),
  ) as Layer.Layer<never, never, HttpRouter.HttpRouter | Static<R>>;
}
