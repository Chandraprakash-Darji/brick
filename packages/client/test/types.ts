import { Effect, Layer, Schema } from "effect";
import type { HttpClientError } from "effect/http/HttpClientError";
import type { HttpClientResponse } from "effect/http/HttpClientResponse";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { api, securedApi, Prefix, Auth, SlugTaken } from "./fixtures/contract";
import { createClient, createEffectClient } from "../src";

async function compilerFixtures() {
  const { client } = await createClient(api, { baseUrl: "http://localhost" });
  const one: { readonly slug: string } = await client.pages.create({
    payload: { slug: "a" },
  });
  const ping: string = await client.ping({});
  const count: number = await client.pages.count({});
  const raw: HttpClientResponse = await client.pages.count({
    responseMode: "response-only",
  });
  const both: [number, HttpClientResponse] = await client.pages.count({
    responseMode: "decoded-and-response",
  });
  // @ts-expect-error Each endpoint retains its own success type.
  const wrong: string = await client.pages.count({});
  // @ts-expect-error The input is not widened to unknown.
  void client.pages.create({ payload: { slug: 123 } });
  // @ts-expect-error No unknown actions.
  void client.pages.remove({});
  // @ts-expect-error Missing required schema AND middleware layers.
  createClient(securedApi, { baseUrl: "http://localhost" });
  createClient(securedApi, {
    baseUrl: "http://localhost",
    // @ts-expect-error Schema layer alone does not provide Auth middleware.
    layer: Layer.succeed(Prefix, "x"),
  });
  const auth = HttpApiMiddleware.layerClient(Auth, ({ request, next }) =>
    next(request),
  );
  // @ts-expect-error Middleware layer alone does not provide schema decoding Prefix.
  createClient(securedApi, { baseUrl: "http://localhost", layer: auth });
  await createClient(securedApi, {
    baseUrl: "http://localhost",
    layer: Layer.merge(auth, Layer.succeed(Prefix, "x")),
  });
  const native = await Effect.runPromise(
    createEffectClient(api).pipe(Effect.provide(FetchHttpClient.layer)),
  );
  const call = native.pages.create({ payload: { slug: "a" } });
  const accurate: Effect.Effect<
    { readonly slug: string },
    SlugTaken | HttpClientError | Schema.SchemaError
  > = call;
  // @ts-expect-error Transport and decoding errors remain in the Effect channel.
  const domainOnly: Effect.Effect<{ readonly slug: string }, SlugTaken> = call;
  const rawEffect: Effect.Effect<HttpClientResponse, HttpClientError> =
    native.pages.create({
      payload: { slug: "a" },
      responseMode: "response-only",
    });
  void [one, ping, count, raw, both, wrong, accurate, domainOnly, rawEffect];
}
void compilerFixtures;
