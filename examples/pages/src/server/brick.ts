// Brick API mount for TanStack Start.
//
// The pages backend (Elysia app in src/api) runs in-process inside
// the Start server via the custom entry in `src/server.ts`. One singleton
// per server process, so the Postgres pool and auth instances are shared.
//
// Owned paths are forwarded verbatim (full URL preserved, so Elysia routes
// on the original pathname). Everything else falls through to Start.
// NOTE: brick's `/docs` is deliberately NOT mounted — `/docs/*` is the
// web docs UI. API docs stay on `/reference` (+ `/swagger`).
import { buildApp } from "../api/app";

type BrickApp = ReturnType<typeof buildApp>;

let app: BrickApp | null = null;

export function getBrickApp(): BrickApp {
  if (!app) app = buildApp();
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
  "/reference",
  "/swagger",
  "/_health",
]);

const PREFIXES = [
  "/api/",
  "/p/",
  "/mcp/",
  "/.well-known/",
  "/reference/",
  "/swagger/",
];

/** True when this pathname is served by the brick backend. */
export function isBrickPath(pathname: string): boolean {
  if (EXACT.has(pathname)) return true;
  return PREFIXES.some((p) => pathname.startsWith(p));
}
