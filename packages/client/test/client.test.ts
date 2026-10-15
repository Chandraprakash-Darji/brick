import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpClient, HttpClientRequest } from "effect/http";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import { api, securedApi, SlugTaken, Prefix, Auth } from "./fixtures/contract";
import { createClient, createEffectClient } from "../src";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import { routes } from "./fixtures/server";

test("Promise and Effect clients roundtrip typed successes and error classes over ephemeral HTTP", async () => {
  const app = HttpRouter.toWebHandler(routes, { disableLogger: true });
  const server = Bun.serve({
    port: 0,
    fetch: (request) => app.handler(request),
  });
  const managed = await createClient(api, { baseUrl: server.url });
  try {
    expect(
      await managed.client.pages.create({ payload: { slug: "new" } }),
    ).toEqual({ slug: "new" });
    expect(await managed.client.pages.create({ slug: "flat" })).toEqual({
      slug: "flat",
    });
    expect(await managed.client.pages.count({})).toBe(42);
    expect(await managed.client.ping({})).toBe("pong");
    const [value, response] = await managed.client.pages.count({
      responseMode: "decoded-and-response",
    });
    expect(value).toBe(42);
    expect(response.status).toBe(200);
    const raw = await managed.client.pages.count({
      responseMode: "response-only",
    });
    expect(raw.status).toBe(200);
    try {
      await managed.client.pages.create({ payload: { slug: "taken" } });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(SlugTaken);
      if (error instanceof SlugTaken) expect(error.slug).toBe("taken");
    }
    const native = await Effect.runPromise(
      createEffectClient(api, { baseUrl: server.url }).pipe(
        Effect.provide(FetchHttpClient.layer),
      ),
    );
    const failure = await Effect.runPromise(
      native.pages.create({ payload: { slug: "taken" } }).pipe(Effect.flip),
    );
    expect(failure).toBeInstanceOf(SlugTaken);
  } finally {
    await managed.dispose();
    await managed.dispose();
    await server.stop(true);
    await app.dispose();
  }
});

test("runtime supplies schema and middleware requirements and closes scoped resources once", async () => {
  let acquired = 0;
  let released = 0;
  const prefix = Layer.effect(
    Prefix,
    Effect.acquireRelease(
      Effect.sync(() => {
        acquired++;
        return "prefix:";
      }),
      () =>
        Effect.sync(() => {
          released++;
        }),
    ),
  );
  const auth = HttpApiMiddleware.layerClient(Auth, ({ request, next }) =>
    next(HttpClientRequest.setHeader(request, "x-client-auth", "yes")),
  );
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      expect(request.headers.get("x-client-auth")).toBe("yes");
      return Response.json("alice");
    },
  });
  const client = await createClient(securedApi, {
    baseUrl: server.url,
    layer: Layer.merge(prefix, auth),
  });
  try {
    expect(await client.client.secure.name({})).toBe("prefix:alice");
    expect(acquired).toBe(1);
    expect(released).toBe(0);
  } finally {
    await client.dispose();
    await client.dispose();
    await server.stop(true);
  }
  expect(released).toBe(1);
});

test("browser entry excludes application server code, Drizzle and Elysia", async () => {
  const result = await Bun.build({
    entrypoints: [import.meta.dir + "/fixtures/browser.ts"],
    target: "browser",
    minify: false,
  });
  expect(result.success).toBe(true);
  const text = await result.outputs[0]!.text();
  for (const forbidden of [
    "HttpApiBuilder",
    "drizzle-orm",
    "elysia",
    "BACKEND_HANDLER_MARKER",
  ]) {
    expect(text.includes(forbidden)).toBe(false);
  }
});

test("failed initialization releases already acquired layer resources", async () => {
  let released = 0;
  const broken = Layer.effect(
    Prefix,
    Effect.acquireRelease(Effect.succeed("ready"), () =>
      Effect.sync(() => {
        released++;
      }),
    ).pipe(Effect.andThen(Effect.fail("startup-failed"))),
  );
  const auth = HttpApiMiddleware.layerClient(Auth, ({ request, next }) =>
    next(request),
  );
  const managed = createClient(securedApi, {
    baseUrl: "http://localhost",
    layer: Layer.merge(broken, auth),
  });
  await expect(managed.ready).rejects.toBe("startup-failed");
  await expect(managed.client.secure.name({})).rejects.toBe("startup-failed");
  expect(released).toBe(1);
  await managed.dispose();
});

test("client fetch options and native transforms reach authenticated requests", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      expect(request.headers.get("x-session")).toBe("cookie-auth");
      expect(request.headers.get("x-transform")).toBe("native");
      return Response.json(42);
    },
  });
  const managed = await createClient(api, {
    baseUrl: server.url,
    fetchOptions: {
      credentials: "include",
      headers: { "x-session": "cookie-auth" },
    },
    transformClient: (client) =>
      HttpClient.mapRequest(client, (request) =>
        HttpClientRequest.setHeader(request, "x-transform", "native"),
      ),
  });
  try {
    expect(await managed.client.pages.count({})).toBe(42);
  } finally {
    await managed.dispose();
    await server.stop(true);
  }
});
