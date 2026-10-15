import { Context, Effect, Layer, Schema } from "effect";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiTest,
} from "effect/http-api";
import { HttpClientError, HttpRouter, HttpServer } from "effect/http";
import { Rpc, RpcGroup } from "effect/rpc";
import { Tool, Toolkit } from "effect/ai";
import { strict as assert } from "node:assert";

type Input<P extends HttpApiEndpoint.Constraint> = Omit<
  HttpApiEndpoint.Request<P>,
  "request" | "endpoint" | "group"
>;
const implement =
  <P extends HttpApiEndpoint.Constraint>(endpoint: P) =>
  <E extends P["~Error"]["Type"], R>(
    handler: (input: Input<P>) => Effect.Effect<P["~Success"]["Type"], E, R>,
  ) =>
    Object.freeze({ endpoint, handler });
interface Service<
  N extends string,
  P extends HttpApiEndpoint.Constraint,
  A extends readonly unknown[],
> {
  readonly group: HttpApiGroup.HttpApiGroup<N, P>;
  readonly actions: A;
}
const empty: readonly [] = [];
const make = <const N extends string>(
  name: N,
): Service<N, never, readonly []> =>
  Object.freeze({ group: HttpApiGroup.make(name), actions: empty });
function append<A extends readonly unknown[], B>(
  a: A,
  b: B,
): readonly [...A, B] {
  return [...a, b];
}
const add =
  <
    P extends HttpApiEndpoint.Constraint,
    E extends P["~Error"]["Type"],
    R,
  >(action: {
    readonly endpoint: P;
    readonly handler: (
      input: Input<P>,
    ) => Effect.Effect<P["~Success"]["Type"], E, R>;
  }) =>
  <
    N extends string,
    Q extends HttpApiEndpoint.Constraint,
    A extends readonly unknown[],
  >(
    service: Service<N, Q, A>,
  ) =>
    Object.freeze({
      group: service.group.add(action.endpoint),
      actions: Object.freeze(append(service.actions, action)),
    });
class Repo extends Context.Service<Repo, { readonly prefix: string }>()(
  "spike/Repo",
) {}
class Missing extends Schema.TaggedError<Missing>()(
  "Missing",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}
class Undeclared extends Schema.TaggedError<Undeclared>()("Undeclared", {}) {}
const ping = implement(
  HttpApiEndpoint.get("ping", "/ping", { success: Schema.String }),
)(() => Effect.succeed("pong"));
const echo = implement(
  HttpApiEndpoint.post("echo", "/echo", {
    payload: Schema.Struct({ name: Schema.String }),
    success: Schema.String,
  }),
)(({ payload }) => Effect.map(Repo, (r) => r.prefix + payload.name));
// Retain source schemas when constructing an endpoint. Do not reverse-reflect
// endpoint.payload's heterogeneous Map to recover its phantom type.
const lookupSchemas = Object.freeze({
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.String,
  error: Missing,
});
const lookupPacket = Schema.Struct({ payload: lookupSchemas.payload });
const lookupContract = Object.freeze({
  endpoint: HttpApiEndpoint.post("lookup", "/lookup", lookupSchemas),
  packet: lookupPacket,
  rpc: Rpc.make("lookup", {
    payload: lookupPacket,
    success: lookupSchemas.success,
    error: lookupSchemas.error,
  }),
  tool: Tool.make("lookup", {
    parameters: lookupPacket,
    success: lookupSchemas.success,
    failure: lookupSchemas.error,
  }),
});
const lookup = implement(lookupContract.endpoint)(({ payload }) =>
  payload.id === "missing"
    ? Effect.fail(new Missing({ id: payload.id }))
    : Effect.succeed(payload.id),
);
// Same packet and same implementation; native adapters check both signatures.
const rpcHandlers = RpcGroup.make(lookupContract.rpc).toLayer({
  lookup: lookup.handler,
});
const toolHandlers = Toolkit.make(lookupContract.tool).toLayer({
  lookup: lookup.handler,
});
void rpcHandlers;
void toolHandlers;
const byId = implement(
  HttpApiEndpoint.get("byId", "/items/:id", {
    params: { id: Schema.Number },
    success: Schema.Number,
  }),
)(({ params }) => Effect.succeed(params.id));
const base = make("pages");
const pages = add(byId)(add(lookup)(add(echo)(add(ping)(base))));
const api = HttpApi.make("spike").add(pages.group);
// This is the generated adapter's complete shape. No second handler implementation.
const handlers = HttpApiBuilder.group(api, "pages", (h) =>
  Effect.gen(function* () {
    const context =
      yield* Effect.context<Effect.Services<ReturnType<typeof echo.handler>>>();
    return h.handleAll({
      ping: ping.handler,
      echo: (input) => echo.handler(input).pipe(Effect.provideContext(context)),
      lookup: lookup.handler,
      byId: byId.handler,
    });
  }),
);
const routes = HttpApiBuilder.layer(api).pipe(
  Layer.provide(handlers),
  Layer.provide(HttpServer.layerServices),
);
const live = Layer.succeed(Repo, { prefix: "hi " });
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
const eq = <_T extends true>() => {};
eq<Equal<Effect.Services<ReturnType<typeof echo.handler>>, Repo>>();
eq<Equal<Effect.Error<ReturnType<typeof echo.handler>>, never>>();
eq<Equal<Effect.Error<ReturnType<typeof lookup.handler>>, Missing>>();
eq<Equal<Layer.Services<typeof handlers>, Repo>>();
type Client = HttpApiClient.ForApi<typeof api>;
const clientResult = (client: Client) =>
  client.pages.byId({ params: { id: 42 } });
eq<Equal<Effect.Success<ReturnType<typeof clientResult>>, number>>();
const clientLookup = (client: Client) =>
  client.pages.lookup({ payload: { id: "missing" } });
eq<
  Equal<
    Effect.Error<ReturnType<typeof clientLookup>>,
    Missing | HttpClientError.HttpClientError | Schema.SchemaError
  >
>();
eq<Equal<Effect.Services<ReturnType<typeof clientLookup>>, never>>();
// @ts-expect-error endpoint has no declared Undeclared error
implement(ping.endpoint)(() => Effect.fail(new Undeclared()));
// @ts-expect-error endpoint requires string output
implement(ping.endpoint)(() => Effect.succeed(42));
function negativeTypeChecks(client: Client) {
  // @ts-expect-error Repo is still required
  HttpRouter.toWebHandler(routes);
  // @ts-expect-error decoded numeric param is required
  client.pages.byId({ params: { id: "42" } });
}
void negativeTypeChecks;
async function main() {
  assert.equal(base.actions.length, 0);
  assert.equal(pages.actions.length, 4);
  assert.equal(
    await Effect.runPromise(
      echo.handler({ payload: { name: "Ada" } }).pipe(Effect.provide(live)),
    ),
    "hi Ada",
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(api, ["pages"]);
      assert.equal(yield* client.pages.ping(), "pong");
      assert.equal(
        yield* client.pages.echo({ payload: { name: "Ada" } }),
        "hi Ada",
      );
      assert.equal(yield* client.pages.byId({ params: { id: 42 } }), 42);
      const error = yield* client.pages
        .lookup({ payload: { id: "missing" } })
        .pipe(Effect.flip);
      assert(error instanceof Missing);
      assert.equal(error.id, "missing");
    }).pipe(
      Effect.provide(handlers.pipe(Layer.provide(live))),
      Effect.provide(HttpServer.layerServices),
      Effect.scoped,
    ),
  );
  console.log(
    "M0 functional builder: four HTTP shapes, local call, typed error decode, immutable extension passed",
  );
}
await main();
