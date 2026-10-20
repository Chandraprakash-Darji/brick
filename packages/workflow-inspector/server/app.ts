import "react-router";
// The React Router server build (virtual module). Imported as a namespace so a
// copy can carry the mount path as its `basename`.
import * as serverBuild from "virtual:react-router/server-build";
import {
  type InspectorHost,
  setInspectorHost,
} from "../app/server/inspector-host.server";
import {
  type AppLoadContext,
  createRequestHandler as createReactRouterRequestHandler,
  type ServerBuild,
} from "react-router";

// Expose `basename` on the React Router load context so the root route can
// surface the embed mount path to the client (see app/root.tsx + lib/api-base).
declare module "react-router" {
  interface AppLoadContext {
    basename?: string;
  }
}

// --- Framework-agnostic fetch handler ----------------------------------------
//
// This module is the SSR build's only entry point, and `createFetchHandler` its
// only export. Both consumers go through it:
//
// - `server.js` — the standalone server, which mounts it at `/` behind srvx's
//   static middleware.
// - `@workflow/web/handler` — a thin sibling file that ships as-is, used to
//   mount the dashboard in-process inside another server (e.g. `@workflow/nitro`
//   at `/_workflow`) without spawning a second HTTP server.
//
// React Router itself is bundled into this build, so the `createRequestHandler`
// wiring must live here rather than in the un-bundled `handler.js`. Static file
// serving is *not* handled here — Vite's dev server covers it in development,
// and each consumer layers its own in front for production.

/** Normalize a mount path: `/` or empty -> "" (root); otherwise strip trailing slash. */
function normalizeBasename(basename: string): string {
  if (!basename || basename === "/") return "";
  return basename.endsWith("/") ? basename.slice(0, -1) : basename;
}

/**
 * Build a framework-agnostic Web `Request` -> `Response` handler for the
 * observability UI, suitable for mounting inside another server. Pass
 * `basename` as the mount prefix. The build writes its file URLs under the Vite
 * `base` (see vite.config.ts), so it must be mounted at that same path.
 *
 * The mount prefix is threaded into the React Router load context so the root
 * route can expose it to the client (RPC/stream fetches need the prefix).
 */
export function createFetchHandler(
  basename = "/",
  host: InspectorHost,
): (request: Request) => Promise<Response> {
  // Brick change: the host gives the inspector its world.
  setInspectorHost(host);
  const normalized = normalizeBasename(basename);
  const build = {
    ...serverBuild,
    basename: normalized || "/",
  } as unknown as ServerBuild;
  const handler = createReactRouterRequestHandler(build, "production");
  const loadContext: AppLoadContext = { basename: normalized };
  return (request: Request) => handler(request, loadContext);
}
