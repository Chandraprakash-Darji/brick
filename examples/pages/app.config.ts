// TanStack Start application-level config.
//
// This file holds app-wide settings (backend origin, dev proxy table,
// Start plugin options, production server shape) in one place — the
// equivalent of the old `app/astro.config.mjs`. It is consumed by
// `vite.config.ts` via `tanstackStart(startOptions)`. Defaults not listed
// here apply: routes dir `src/routes`, router `src/router.tsx`.

/**
 * Self origin for server-side API calls (SSR).
 *
 * The brick backend is mounted in-process (see `src/server.ts`), so the
 * Start server itself answers `/api/*`. SSR has no request origin for
 * relative URLs, hence an absolute fallback: `BACKEND_ORIGIN` env in
 * production (the public origin), plain `http://localhost:5174` in dev.
 */
export const BACKEND_ORIGIN =
  process.env.BACKEND_ORIGIN ?? "http://localhost:5174";

/** Node server output for `bun run build` followed by `bun run start`. */
export const SERVER_PRESET = "node-server" as const;

/**
 * Production runtime host/port.
 * Honored by `vite preview` (which serves the Start server bundle via
 * the plugin's preview-server hook) and by the `frontend` service in
 * docker-compose (`PORT: "5174"`). `HOST` defaults to `0.0.0.0` so the
 * container accepts traffic from the Caddy/Nginx proxy.
 */
export const HOST = process.env.HOST ?? "0.0.0.0";
export const PORT = Number(process.env.PORT ?? 5174);

/**
 * Options forwarded to `tanstackStart()`.
 * Kept explicit (even when empty) so server/deploy settings have a
 * single home independent of the vite plumbing in `vite.config.ts`.
 */
export const startOptions = {};
