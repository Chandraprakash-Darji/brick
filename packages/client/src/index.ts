import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import type * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import type * as HttpApiGroup from "effect/http-api/HttpApiGroup";

export const createEffectClient = HttpApiClient.make;
export type ClientServices<Groups extends HttpApiGroup.Constraint> =
  | HttpApiGroup.ClientServices<Groups>
  | HttpApiGroup.MiddlewareClient<Groups>;
type Mode = HttpApiClient.Client.ResponseMode;
type PartType<S> = [S] extends [never]
  ? unknown
  : S extends { readonly Type: infer T }
    ? T
    : unknown;
/** Legacy pre-Effect call shape: body fields and `:param` values passed flat. */
export type FlatRequest<Endpoint extends HttpApiEndpoint.ConstraintRequest> =
  PartType<Endpoint["~Params"]> &
    PartType<Endpoint["~Query"]> &
    PartType<Endpoint["~Payload"]> &
    PartType<Endpoint["~Headers"]>;
export type PromiseMethod<Endpoint extends HttpApiEndpoint.ConstraintRequest> =
  {
    <M extends Mode = "decoded-only">(
      request: HttpApiEndpoint.ClientRequest<
        Endpoint["~Params"],
        Endpoint["~Query"],
        Endpoint["~Payload"],
        Endpoint["~Headers"],
        M
      >,
    ): Promise<
      HttpApiClient.Client.Response<
        HttpApiClient.SuccessType<Endpoint["~Success"]>,
        M
      >
    >;
    (
      request: FlatRequest<Endpoint>,
    ): Promise<HttpApiClient.SuccessType<Endpoint["~Success"]>>;
  };
type Methods<Endpoints extends HttpApiEndpoint.Constraint> = {
  readonly [E in Endpoints as E["identifier"]]: PromiseMethod<
    Extract<E, HttpApiEndpoint.ConstraintRequest>
  >;
};
export type PromiseClient<Groups extends HttpApiGroup.Constraint> = {
  readonly [
    G in Extract<Groups, { readonly topLevel: false }> as G["identifier"]
  ]: Methods<HttpApiGroup.Endpoints<G>>;
} & Methods<
  HttpApiGroup.Endpoints<Extract<Groups, { readonly topLevel: true }>>
>;

type Options<Groups extends HttpApiGroup.Constraint, E> = {
  readonly baseUrl: string | URL;
  readonly fetchOptions?: globalThis.RequestInit;
  readonly transformClient?: (
    client: HttpClient.HttpClient,
  ) => HttpClient.HttpClient;
} & ([ClientServices<Groups>] extends [never]
  ? { readonly layer?: Layer.Layer<never, E, never> }
  : { readonly layer: Layer.Layer<ClientServices<Groups>, E, never> });

const requestPartKeys = ["params", "query", "payload", "headers"] as const;

/**
 * Accept legacy pre-Effect flat calls alongside structured HttpApi requests.
 * Flat objects carry `:param` values and body fields together, so split them:
 * route `:param` segments become `params`, the remainder becomes `query` when
 * the endpoint declares one and `payload` otherwise. Calls already using
 * request parts pass through untouched, as does a top-level `responseMode`.
 */
const normalizeRequest = (
  endpoint: HttpApiEndpoint.Top,
  request: unknown,
): unknown => {
  if (typeof request !== "object" || request === null) return request;
  const { responseMode, ...data } = request as Record<string, unknown> & {
    readonly responseMode?: unknown;
  };
  const keys = Object.keys(data);
  if (
    keys.length > 0 &&
    keys.every((key) => (requestPartKeys as readonly string[]).includes(key))
  ) {
    return request;
  }
  const names = [...endpoint.path.matchAll(/:(\w+)/g)].map((match) => match[1]);
  const params: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    (names.includes(key) ? params : rest)[key] = value;
  }
  const normalized: Record<string, unknown> = {};
  if (names.length > 0) normalized.params = params;
  if (endpoint.query !== undefined) normalized.query = rest;
  else if (endpoint.payload.size > 0) normalized.payload = rest;
  if (responseMode !== undefined) normalized.responseMode = responseMode;
  return normalized;
};

/**
 * Owns one scoped runtime. Creation is synchronous; the native client builds in
 * the background. `ready` settles when it is built (or rejects with the layer's
 * failure), and the first call also surfaces that failure. Rejection values are
 * untyped in TypeScript.
 */
export function createClient<
  Id extends string,
  Groups extends HttpApiGroup.Constraint,
  E = never,
>(
  api: HttpApi.HttpApi<Id, Groups>,
  options: Options<Groups, E>,
): {
  readonly client: PromiseClient<Groups>;
  readonly ready: Promise<void>;
  readonly dispose: () => Promise<void>;
} {
  // Conditional options cannot reduce while Groups is open. This assertion only
  // restores the requirement already enforced at the public call site.
  const dependencies = (options.layer ?? Layer.empty) as Layer.Layer<
    ClientServices<Groups>,
    E,
    never
  >;
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      FetchHttpClient.layer,
      dependencies,
      Layer.succeed(FetchHttpClient.RequestInit, options.fetchOptions ?? {}),
    ),
  );
  const run = async <A, Failure>(
    effect: Effect.Effect<
      A,
      Failure,
      HttpClient.HttpClient | ClientServices<Groups>
    >,
  ): Promise<A> => {
    const exit = await runtime.runPromiseExit(effect);
    if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
    return exit.value;
  };
  const native = run(
    HttpApiClient.make(api, {
      baseUrl: options.baseUrl,
      transformClient: options.transformClient,
    }),
  );
  // Failures are reported through `ready` and the first call; this branch only
  // prevents an unhandled-rejection warning when neither is observed yet.
  void native.catch(() => undefined);
  const promises: Record<string, unknown> = Object.create(null);
  // Reflection enumerates exactly the native methods. Only this dynamic
  // adaptation boundary erases endpoint correlation; PromiseClient preserves it.
  HttpApi.reflect(api, {
    onGroup({ group }) {
      if (!group.topLevel) promises[group.identifier] = Object.create(null);
    },
    onEndpoint({ group, endpoint }) {
      const target = group.topLevel
        ? promises
        : (promises[group.identifier] as Record<string, unknown>);
      target[endpoint.identifier] = async (request: unknown) => {
        const built = (await native) as Record<string, unknown>;
        const source = group.topLevel
          ? built
          : (built[group.identifier] as Record<string, unknown>);
        const method = source[endpoint.identifier] as (
          request: unknown,
        ) => Effect.Effect<
          unknown,
          unknown,
          HttpClient.HttpClient | ClientServices<Groups>
        >;
        return run(method(normalizeRequest(endpoint, request)));
      };
    },
  });
  return {
    client: promises as PromiseClient<Groups>,
    ready: native.then(() => undefined),
    dispose: () => runtime.dispose(),
  };
}
