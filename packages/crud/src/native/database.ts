import { Context, Effect, Layer, Scope } from "effect";

/** Self is an application-defined nominal identity. Acquisition stays in Layer. */
export const database =
  <Self>() =>
  <Db, E, R>(
    name: string,
    make: Effect.Effect<Db, E, R>,
  ): {
    readonly Service: Context.Service<Self, Db>;
    readonly layer: Layer.Layer<Self, E, Exclude<R, Scope.Scope>>;
  } => {
    class Service extends Context.Service<Self, Db>()(name) {}
    return Object.freeze({ Service, layer: Layer.effect(Service, make) });
  };
