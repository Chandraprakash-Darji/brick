import { expect, test } from "bun:test";
import { Cause, Context, Effect, Layer, Schema, Exit } from "effect";
import { HttpApiMiddleware } from "effect/http-api";
import { FetchHttpClient, HttpServerRequest } from "effect/http";
import { RpcClient, RpcMiddleware, RpcSerialization } from "effect/rpc";
import { Brick } from "../src/native";
class User extends Context.Service<User, string>()("native-middleware/User") {}
class Auth extends HttpApiMiddleware.Service<Auth, { provides: User }>()(
  "native-middleware/Auth",
) {}
class RpcAuth extends RpcMiddleware.Service<RpcAuth>()(
  "native-middleware/RpcAuth",
) {}
const define = Brick.action("who", "/who", {
  input: Schema.Struct({}),
  output: Schema.String,
  errors: [],
});
const implementation = define(() =>
  Effect.gen(function* () {
    return yield* User;
  }),
);
const guarded = {
  ...implementation,
  endpoint: implementation.endpoint.middleware(Auth),
};
const service = Brick.service("test", { actions: { who: guarded } });
// @ts-expect-error Endpoint middleware itself must be supplied.
const missing = () => Brick.app({ services: [service], layer: Layer.empty });
void missing;
const plain = define(() => Effect.succeed("ok"));
const rpcGuarded = { ...plain, rpc: plain.rpc.middleware(RpcAuth) };
const rpcService = Brick.service("rpc-test", { actions: { who: rpcGuarded } });
const missingRpc = () =>
  Brick.app({
    services: [rpcService],
    // @ts-expect-error RPC middleware itself must be supplied.
    layer: Layer.empty,
    transports: { rpc: { path: "/rpc" } },
  });
void missingRpc;

test("endpoint middleware provides per-request services without global identity requirements", async () => {
  const app = Brick.app({
    services: [service],
    layer: Layer.succeed(Auth, (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        return yield* effect.pipe(
          Effect.provideService(User, request.headers["x-user"] ?? "anonymous"),
        );
      }),
    ),
  });
  try {
    const responses = await Promise.all(
      ["alice", "bob"].map((user) =>
        app
          .fetch(
            new Request("http://localhost/who", {
              method: "POST",
              headers: { "content-type": "application/json", "x-user": user },
              body: "{}",
            }),
          )
          .then((r) => r.json()),
      ),
    );
    expect(responses).toEqual(["alice", "bob"]);
  } finally {
    await app.dispose();
  }
});

test("RPC defects and output encoder defects redact private messages", async () => {
  const secret = "private-password-123";
  const die = Brick.action("die", "/die", {
    input: Schema.Struct({}),
    output: Schema.String,
    errors: [],
  })(() => Effect.die(new Error(secret)));
  const invalid = Brick.action("invalid", "/invalid", {
    input: Schema.Struct({}),
    output: Schema.String,
    errors: [],
  })(() => Effect.succeed(42 as unknown as string));
  const actions = { die, invalid };
  const app = Brick.app({
    services: [Brick.service("test", { actions })],
    layer: Layer.empty,
    transports: { rpc: { path: "/rpc" } },
  });
  const server = Bun.serve({ port: 0, fetch: (request) => app.fetch(request) });
  try {
    for (const method of ["die", "invalid"] as const) {
      const response = await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* RpcClient.make(Brick.rpcGroup(actions));
          return yield* client[method]({}).pipe(Effect.exit);
        }).pipe(
          Effect.provide(
            RpcClient.layerProtocolHttp({
              url: new URL("rpc", server.url).toString(),
            }).pipe(
              Layer.provide(FetchHttpClient.layer),
              Layer.provide(RpcSerialization.layerJson),
            ),
          ),
          Effect.scoped,
        ),
      );
      expect(JSON.stringify(response)).not.toContain(secret);
      expect(Exit.isFailure(response)).toBe(true);
      if (Exit.isFailure(response))
        expect(String(Cause.squash(response.cause))).toBe(
          "Error: Internal server error",
        );
    }
  } finally {
    await server.stop(true);
    await app.dispose();
  }
});
