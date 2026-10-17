// Brick API mount for TanStack Start.
//
// The pages backend (Elysia app in src/api) runs in-process inside
// the Start server via the custom entry in `src/server.ts`. The Vite plugin
// loads its default export and tracks backend dependencies for hot reload.
//
// Owned paths are forwarded verbatim (full URL preserved, so Elysia routes
// on the original pathname). Everything else falls through to Start.
// NOTE: brick's `/docs` is deliberately NOT mounted — `/docs/*` is the
// web docs UI. The API reference lives in the `brick dev` dashboard; the
// OpenAPI document stays on `/openapi.json` (+ Swagger UI on `/swagger`).
import app from "virtual:brick-app";

export function getBrickApp() {
  return app;
}

/** Forward one request to the brick app (web-standard fetch in/out). */
export function handleBrickRequest(
  request: Request,
): Response | Promise<Response> {
  return getBrickApp().fetch(request);
}

const EXACT = new Set([
  "/api",
  "/p",
  "/mcp",
  "/openapi.json",
  "/swagger",
  "/_health",
]);

const PREFIXES = ["/api/", "/p/", "/mcp/", "/.well-known/", "/swagger/"];

/** True when this pathname is served by the brick backend. */
export function isBrickPath(pathname: string): boolean {
  if (EXACT.has(pathname)) return true;
  return PREFIXES.some((p) => pathname.startsWith(p));
}
