import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { OpenApi } from "effect/http-api";
import { Api } from "./contract";
import { toolActions } from "./services/pages/page/service";
import { McpProtocol } from "effect/ai";
import { requireMcpAuth } from "@better-auth/mcp";
import { Brick } from "@brickkit/core";
import { and, eq } from "drizzle-orm";
import { Auth, authLayer } from "./auth";
import { authDatabaseLayer, databaseLayer, PagesDatabase } from "./db";
import {
  pagesService,
  pagesTable,
  renderPageDocument,
} from "./services/pages/service";
import { baseUrlSecret, mcpResourceSecret, databaseUrlSecret } from "./secrets";

const authRoute = (target?: string) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const web = yield* HttpServerRequest.toWeb(request);
    const url = new URL(web.url);
    if (target) url.pathname = target;
    return HttpServerResponse.fromWeb(
      yield* Effect.promise(() =>
        auth.handler(target ? new Request(url, web) : web),
      ),
    );
  });
const metadata = Brick.route(
  "GET",
  "/.well-known/oauth-protected-resource",
  Effect.sync(() =>
    HttpServerResponse.jsonUnsafe({
      authorization_servers: [baseUrlSecret.require()],
      resource: mcpResourceSecret.require(),
    }),
  ),
);
const bearerGuard = Layer.unwrap(
  Effect.gen(function* () {
    const auth = yield* Auth;
    return HttpRouter.use((router) =>
      router.addGlobalMiddleware((effect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (new URL(request.url, "http://localhost").pathname !== "/mcp")
            return yield* effect;
          const web = yield* HttpServerRequest.toWeb(request).pipe(
            Effect.orDie,
          );
          const response = yield* Effect.promise(() =>
            requireMcpAuth(auth, () => new Response(null, { status: 204 }), {
              resource: mcpResourceSecret.require(),
            })(web),
          );
          if (!response.ok) return HttpServerResponse.fromWeb(response);
          return yield* effect;
        }),
      ),
    );
  }),
);
const routes = Layer.mergeAll(
  bearerGuard,
  Brick.route(
    "GET",
    "/openapi.json",
    Effect.sync(() => HttpServerResponse.jsonUnsafe(OpenApi.fromApi(Api))),
  ),
  Brick.route(
    "GET",
    "/api/public/pages/:slug",
    Effect.gen(function* () {
      const { params } = yield* HttpRouter.RouteContext;
      return yield* toolActions.get_public_page
        .handler({ slug: params.slug ?? "" })
        .pipe(
          Effect.match({
            onSuccess: (page) => HttpServerResponse.jsonUnsafe(page),
            onFailure: (error) =>
              HttpServerResponse.jsonUnsafe(
                { message: error.message },
                { status: error._tag === "NotFound" ? 404 : 500 },
              ),
          }),
        );
    }),
  ),
  Brick.route("*", "/api/auth/*", authRoute()),
  Brick.route("GET", "/jwks", authRoute("/api/auth/jwks")),
  Brick.route(
    "GET",
    "/.well-known/oauth-authorization-server",
    authRoute("/api/auth/.well-known/oauth-authorization-server"),
  ),
  Brick.route(
    "GET",
    "/.well-known/openid-configuration",
    authRoute("/api/auth/.well-known/openid-configuration"),
  ),
  metadata,
  Brick.route(
    "GET",
    "/.well-known/oauth-protected-resource/mcp",
    Effect.sync(() =>
      HttpServerResponse.jsonUnsafe({
        authorization_servers: [baseUrlSecret.require()],
        resource: mcpResourceSecret.require(),
      }),
    ),
  ),
  Brick.route(
    "GET",
    "/p/:slug",
    Effect.gen(function* () {
      const { params } = yield* HttpRouter.RouteContext;
      const db = yield* PagesDatabase;
      const [page] = yield* db
        .select()
        .from(pagesTable)
        .where(
          and(
            eq(pagesTable.slug, params.slug ?? ""),
            eq(pagesTable.isPublic, true),
          ),
        )
        .limit(1)
        .pipe(Effect.orDie);
      return HttpServerResponse.text(
        page ? renderPageDocument(page) : "<h1>404</h1><p>Page not found</p>",
        {
          contentType: "text/html; charset=utf-8",
          status: page ? 200 : 404,
          headers: {
            "cache-control": page
              ? "public, max-age=60, s-maxage=300, stale-while-revalidate=600"
              : "public, max-age=30, s-maxage=30",
          },
        },
      );
    }),
  ),
);
export function buildApp(options: { databaseUrl?: string } = {}) {
  const url = options.databaseUrl ?? databaseUrlSecret.require();
  const dependencies = Layer.merge(
    databaseLayer(url),
    authLayer.pipe(Layer.provide(authDatabaseLayer(url))),
  );
  const app = Brick.app({
    services: [pagesService],
    layer: dependencies,
    routes,
    docs: { path: "/reference" },
    client: { module: "./contract", exportName: "Api" },
    transports: {
      mcp: {
        name: "pages-agent",
        version: "0.1.0",
        path: "/mcp",
        protocols: [McpProtocol.v2025_11_25],
      },
    },
  });
  const fetch = async (request: Request) => {
    const headers = {
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Origin":
        request.headers.get("origin") ?? baseUrlSecret.require(),
      Vary: "Origin",
    };
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    const response = await app.fetch(request);
    const result = new Response(response.body, response);
    for (const [key, value] of Object.entries(headers))
      result.headers.set(key, value);
    return result;
  };
  return Object.freeze({ ...app, fetch });
}
export default buildApp();
