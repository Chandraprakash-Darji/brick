import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { HttpServer } from "effect/http";
import { api, SlugTaken } from "./contract";

const handlers = HttpApiBuilder.group(api, "pages", (h) =>
  h
    .handle("create", ({ payload }) =>
      (payload.slug === "taken"
        ? Effect.fail(new SlugTaken({ slug: payload.slug }))
        : Effect.succeed(payload)
      ).pipe(Effect.withSpan("BACKEND_HANDLER_MARKER")),
    )
    .handle("count", () => Effect.succeed(42)),
);
const system = HttpApiBuilder.group(api, "system", (h) =>
  h.handle("ping", () => Effect.succeed("pong")),
);
export const routes = HttpApiBuilder.layer(api).pipe(
  Layer.provide(Layer.merge(handlers, system)),
  Layer.provide(HttpServer.layerServices),
);
