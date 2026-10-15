import { expect, test } from "bun:test";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSecurity,
} from "effect/http-api";

class CurrentUser extends Context.Service<
  CurrentUser,
  { readonly id: string }
>()("spike/CurrentUser") {}
class Repo extends Context.Service<Repo, { readonly prefix: string }>()(
  "spike/Repo",
) {}
class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {},
  { httpApiStatus: 401 },
) {}
class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentUser }
>()("spike/Authorization", {
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}

const api = HttpApi.make("auth-spike").add(
  HttpApiGroup.make("pages").add(
    HttpApiEndpoint.get("me", "/me", { success: Schema.String }).middleware(
      Authorization,
    ),
  ),
);
const handlers = HttpApiBuilder.group(api, "pages", (h) =>
  Effect.gen(function* () {
    const repo = yield* Repo;
    return h.handle("me", () =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        yield* Effect.yieldNow;
        return repo.prefix + user.id;
      }),
    );
  }),
);
const authorization = Layer.succeed(
  Authorization,
  Authorization.of({
    bearer: (effect, { credential }) => {
      const id = Redacted.value(credential);
      return id === "alice" || id === "bob"
        ? Effect.provideService(effect, CurrentUser, { id })
        : Effect.fail(new Unauthorized());
    },
  }),
);
const routes = HttpApiBuilder.layer(api).pipe(
  Layer.provide(handlers),
  Layer.provide(authorization),
  Layer.provide(HttpServer.layerServices),
);

function missingRepository() {
  // @ts-expect-error Repo must be supplied before creating a web handler.
  HttpRouter.toWebHandler(routes);
}
void missingRepository;

test("request identity stays isolated while two apps capture different repository layers", async () => {
  const first = HttpRouter.toWebHandler(
    routes.pipe(Layer.provide(Layer.succeed(Repo, { prefix: "one:" }))),
    { disableLogger: true },
  );
  const second = HttpRouter.toWebHandler(
    routes.pipe(Layer.provide(Layer.succeed(Repo, { prefix: "two:" }))),
    { disableLogger: true },
  );
  const request = (user: string) =>
    new Request("http://localhost/me", {
      headers: { authorization: `Bearer ${user}` },
    });
  try {
    expect((await first.handler(request("wrong"))).status).toBe(401);
    const responses = await Promise.all([
      first.handler(request("alice")),
      first.handler(request("bob")),
      second.handler(request("alice")),
      second.handler(request("bob")),
    ]);
    expect(
      await Promise.all(responses.map((response) => response.json())),
    ).toEqual(["one:alice", "one:bob", "two:alice", "two:bob"]);
    await first.dispose();
    const response = await second.handler(request("alice"));
    expect(await response.json()).toBe("two:alice");
  } finally {
    await first.dispose();
    await second.dispose();
  }
});
