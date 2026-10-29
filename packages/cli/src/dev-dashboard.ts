import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DevDocs } from "./dev-docs";
import { INSPECTOR_PATH, INSPECTOR_TOKEN_HEADER } from "./dev-inspector";
import { parseHistoryQuery, type DevHistory } from "./dev-history";
import type { TelemetryRecord } from "./dev-telemetry";
import type {
  DevTelemetryEvent,
  DevTelemetryStore,
} from "./dev-telemetry-store";
import { dashboardShell } from "./dev-dashboard-shell";
import type { DashboardAuth } from "@brickkit/core";
import { createAccess, isLoopbackHost } from "./dashboard-access";
import {
  assetsDirectory,
  DashboardExtensions,
  type PluginDashboard,
  themeCss,
  type DashboardExtensionOptions,
} from "./dashboard-extension";

export const DEFAULT_DASHBOARD_PORT = 9400;
const KEEPALIVE_MS = 15_000;
const MAX_INGEST_BYTES = 5 * 1024 * 1024;
const MAX_PROXY_BYTES = 10 * 1024 * 1024;
// Request headers that describe one hop or the dashboard's own page, and
// response headers that fetch has already applied or that mean nothing here.
const NOT_FORWARDED = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "content-length",
  "accept-encoding",
  "origin",
  "referer",
  "cookie",
]);
const NOT_RETURNED = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "content-encoding",
  "set-cookie",
]);

/**
 * What a production dashboard may show: the shell and its assets, the live
 * state and its event stream, and stored history. Nothing that changes the app
 * or reaches into it (restart, the API proxy, ingest) and nothing from the
 * project's source (documentation, OpenAPI documents). With an extension, the
 * `/app` proxy its pages read the app through.
 */
const isMonitoringRoute = (
  method: string | undefined,
  pathname: string,
  extension: boolean,
) =>
  (extension && isAppRoute(pathname)) ||
  (method === "GET" &&
    (pathname === "/" ||
      pathname.startsWith("/assets/") ||
      pathname === "/api/state" ||
      pathname === "/api/events" ||
      pathname.startsWith("/api/history")));

/** `/app/*` reaches the app itself, for the extension's `useAppFetch`. */
const APP_PATH = "/app";
const isAppRoute = (pathname: string) =>
  pathname === APP_PATH || pathname.startsWith(`${APP_PATH}/`);

const PRODUCTION_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  // Requests and logs are private: nothing caches them on the way.
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

/** How long `/_health` waits for the app before calling it down. */
const PROBE_TIMEOUT_MS = 3000;

export interface DevDashboardOptions {
  port: number;
  /**
   * The address to listen on; loopback by default. Any other address needs
   * `auth`, and the server refuses to start without it.
   */
  host?: string;
  /**
   * `"production"` is the read-only monitoring dashboard of `brick start`: it
   * serves only what `isMonitoringRoute` lists, with security headers, and
   * tells its page to hide the tabs that need a developer's machine.
   */
  mode?: "dev" | "production";
  /** Who may use the dashboard, checked before anything but `/_health`. */
  auth?: DashboardAuth;
  /** Whether the app answers; `/_health` reports it, for uptime monitors. */
  probe?: () => Promise<boolean>;
  store: DevTelemetryStore;
  /** Requests kept on disk; omit to serve live data only. The page hides its History view. */
  history?: DevHistory;
  /** The app's developer documentation, when it has any, as of this request. */
  docs?: () => DevDocs | undefined;
  /** Omit when the host cannot restart the application; the page hides its button. */
  restart?: () => void;
  /**
   * The project's extension and theme. In dev mode the extension is rebuilt as
   * its folder changes, and the page reloads; production serves it as built.
   */
  dashboard?: DashboardExtensionOptions;
  /** Where `/app/*` goes; the app the store's API documents name otherwise. */
  appUrl?: string;
}

export interface DevDashboard {
  readonly port: number;
  /** Build and serve the dashboard extensions the app's plugins ship (dev only). */
  setPluginExtensions(plugins: readonly PluginDashboard[]): Promise<void>;
  stop(): void;
}

/**
 * Serve the dashboard, on loopback unless told otherwise. On loopback requests
 * must name a local host (blocks DNS rebinding), and restart requires a header
 * that cross-origin pages cannot send without a preflight. Elsewhere `auth` is
 * required and decides who gets in. Uses node:http, so it runs under Bun and
 * under Node (Vite's dev server runs under Node).
 */
export function startDevDashboard(
  options: DevDashboardOptions,
): Promise<DevDashboard> {
  const host = options.host ?? "127.0.0.1";
  const loopback = isLoopbackHost(host);
  const production = options.mode === "production";
  if (!loopback && !options.auth) {
    return Promise.reject(
      new Error(
        `Brick: the dashboard would listen on ${host}, where others can reach it, so it needs access control. Set dashboard.auth with a token or an authorize function.`,
      ),
    );
  }
  let theme: string;
  try {
    theme = themeCss(options.dashboard?.theme);
  } catch (error) {
    return Promise.reject(error);
  }
  // In dev, plugins' extensions can join later (`setPluginExtensions`).
  const extension =
    options.dashboard?.extension || !production
      ? new DashboardExtensions(options.dashboard?.extension, (message) =>
          console.warn(message),
        )
      : undefined;
  const access = options.auth
    ? createAccess(options.auth, (error) =>
        console.error("[Brick-TS] The dashboard sign-in check failed:", error),
      )
    : undefined;
  let allowedHosts = new Set<string>();
  const server = createServer((request, response) => {
    respond(request, response).catch((error: unknown) => {
      console.error("[Brick-TS] The dashboard failed to answer:", error);
      if (response.headersSent) response.end();
      else send(response, 500, "Server error");
    });
  });

  async function respond(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (production)
      for (const [name, value] of Object.entries(PRODUCTION_HEADERS))
        response.setHeader(name, value);
    if (loopback && !allowedHosts.has(request.headers.host ?? "")) {
      send(response, 403, "Forbidden");
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const { pathname } = url;
    // The one route open to everyone: uptime monitors cannot sign in.
    if (
      pathname === "/_health" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      await health(response);
      return;
    }
    if (access) {
      const decision = await access(request);
      if (!decision.allowed) {
        send(response, decision.status, decision.body, decision.headers);
        return;
      }
    }
    if (
      production &&
      !isMonitoringRoute(request.method, pathname, Boolean(extension?.active))
    ) {
      send(response, 404, "Not found");
      return;
    }
    handle(request, response, url);
  }

  /** 200 while the app answers its own health check, 503 when it does not. */
  async function health(response: ServerResponse): Promise<void> {
    const probe = options.probe;
    let up = true;
    if (probe) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      up = await Promise.race([
        probe().catch(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(timer);
    }
    send(
      response,
      up ? 200 : 503,
      JSON.stringify({
        status: up ? "ok" : "degraded",
        ...(probe ? { app: up ? "up" : "down" } : {}),
      }),
      { "content-type": "application/json", "cache-control": "no-store" },
    );
  }

  function handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): void {
    const { pathname } = url;
    if (request.method === "GET" && pathname === "/") {
      send(
        response,
        200,
        dashboardShell({
          extension: extension?.active
            ? {
                revision: extension.revision,
                js: Boolean(extension.built),
                css: Boolean(extension.built?.css),
              }
            : undefined,
          theme: theme !== "",
        }),
        {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      );
      return;
    }
    if (request.method === "GET" && pathname.startsWith("/assets/")) {
      const name = pathname.slice("/assets/".length);
      // The project's own files, kept in memory beside the dashboard's.
      const own = name === "brick-theme.css" ? theme : extension?.asset(name);
      if (own !== undefined)
        send(response, 200, own, {
          "content-type": ASSET_TYPES[extname(name)]!,
          "cache-control": "no-store",
        });
      else serveAsset(response, name);
      return;
    }
    if (isAppRoute(pathname)) {
      void app(request, response, url);
      return;
    }
    if (request.method === "GET" && pathname === "/api/state") {
      send(response, 200, JSON.stringify(snapshot()), {
        "content-type": "application/json",
      });
      return;
    }
    if (request.method === "GET" && pathname === "/api/events") {
      eventStream(request, response);
      return;
    }
    if (
      request.method === "GET" &&
      pathname.startsWith("/api/history") &&
      options.history
    ) {
      history(options.history, pathname, url.searchParams, response);
      return;
    }
    if (request.method === "GET" && pathname.startsWith("/api/docs")) {
      void docsRoute(response, pathname, url.searchParams);
      return;
    }
    if (request.method === "GET" && pathname === "/api/openapi") {
      send(response, 200, JSON.stringify(options.store.apiDocuments()), {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      return;
    }
    if (pathname === "/api/proxy") {
      void proxy(request, response, url);
      return;
    }
    if (
      pathname === INSPECTOR_PATH ||
      pathname.startsWith(`${INSPECTOR_PATH}/`)
    ) {
      // Only the dashboard may frame it: framed by another site, a click could
      // land on Cancel or Replay. The rest of the dashboard may be embedded.
      response.setHeader("content-security-policy", "frame-ancestors 'self'");
      response.setHeader("x-frame-options", "SAMEORIGIN");
      void inspector(request, response, url);
      return;
    }
    if (request.method === "POST" && pathname === "/api/ingest") {
      ingest(request, response);
      return;
    }
    if (
      request.method === "POST" &&
      pathname === "/api/restart" &&
      options.restart
    ) {
      if (request.headers["x-brick-dashboard"] !== "1") {
        send(response, 403, "Forbidden");
        return;
      }
      options.restart();
      send(response, 202, "");
      return;
    }
    send(response, 404, "Not found");
  }

  function snapshot() {
    return {
      ...options.store.snapshot(),
      canRestart: Boolean(options.restart),
      historyDays: options.history?.days ?? 0,
      mode: production ? "production" : "dev",
      extension: extension?.active
        ? { revision: extension.revision, error: extension.error }
        : null,
    };
  }

  /**
   * Accept telemetry from an application process that cannot share memory with
   * the dashboard, such as a dev server worker: span batches, and a notice when
   * the app loads.
   */
  function ingest(request: IncomingMessage, response: ServerResponse) {
    if (request.headers["x-brick-dashboard"] !== "1") {
      send(response, 403, "Forbidden");
      return;
    }
    let body = "";
    let rejected = false;
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      if (rejected) return;
      body += chunk;
      if (body.length > MAX_INGEST_BYTES) {
        rejected = true;
        send(response, 413, "Payload too large");
        request.destroy();
      }
    });
    request.on("end", () => {
      if (rejected) return;
      try {
        const payload = JSON.parse(body) as {
          records?: TelemetryRecord[];
          worker?: string;
        };
        if (Array.isArray(payload.records)) {
          options.store.ingest(payload.records, options.store.latestGeneration);
        }
        if (typeof payload.worker === "string") {
          options.store.startGeneration(payload.worker);
        }
        send(response, 204, "");
      } catch {
        send(response, 400, "Bad request");
      }
    });
  }

  /** The Docs tab's data: tree, compiled pages, search, images, components. */
  async function docsRoute(
    response: ServerResponse,
    pathname: string,
    params: URLSearchParams,
  ): Promise<void> {
    const docs = options.docs?.();
    if (!docs) {
      send(response, 404, "The app has no documentation.");
      return;
    }
    const json = (body: unknown) =>
      send(response, 200, JSON.stringify(body), {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
    try {
      if (pathname === "/api/docs") return json(docs.info());
      if (pathname === "/api/docs/search")
        return json(await docs.search(params.get("q") ?? ""));
      if (pathname === "/api/docs/components.js") {
        const code = await docs.components();
        if (code === undefined) return send(response, 404, "No components.");
        return send(response, 200, code, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
        });
      }
      const pagePrefix = "/api/docs/page";
      if (pathname === pagePrefix || pathname.startsWith(`${pagePrefix}/`)) {
        const slugs = pathname
          .slice(pagePrefix.length)
          .split("/")
          .filter(Boolean)
          .map(decodeURIComponent);
        const page = await docs.page(slugs);
        return page ? json(page) : send(response, 404, "No such page.");
      }
      const filePrefix = "/api/docs/files/";
      if (pathname.startsWith(filePrefix)) {
        const file = await docs.file(
          pathname
            .slice(filePrefix.length)
            .split("/")
            .map(decodeURIComponent)
            .join("/"),
        );
        if (!file) return send(response, 404, "No such file.");
        return send(response, 200, file.body, {
          "content-type": file.type,
          "cache-control": "no-store",
          // An image in a page; a document opened directly cannot run scripts.
          "content-security-policy": "sandbox",
        });
      }
      send(response, 404, "Not found");
    } catch (error) {
      send(
        response,
        error instanceof URIError ? 400 : 500,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Send a request on to the app for the APIs view, which cannot call the app
   * directly: it is another origin. Only the dashboard's own page may use this,
   * and only to reach the app being shown. The address to call is `?url=`; a
   * `?cookie=` is the cookie parameters the reader typed into Try it, and the
   * only cookie the app is sent (the dashboard's own are never forwarded).
   */
  /**
   * Pass a request to the workflow inspector, which the app serves on a port of
   * its own, and stream its answer back (it follows a run's output as it
   * grows). Anyone who can open the dashboard may look, but a change must come
   * from the dashboard's own page: the inspector can cancel runs and resume
   * hooks, and a page on another site could otherwise post to it.
   */
  async function inspector(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const target = options.store.inspectorTarget();
    if (!target) {
      send(
        response,
        503,
        "The workflow inspector is not running. The app may be restarting, or it may run no workflows.",
        { "content-type": "text/plain; charset=utf-8" },
      );
      return;
    }
    const bodyless = request.method === "GET" || request.method === "HEAD";
    const site = request.headers["sec-fetch-site"];
    const origin = request.headers.origin;
    if (
      !bodyless &&
      ((site !== undefined && site !== "same-origin") ||
        (origin !== undefined && origin !== `http://${request.headers.host}`))
    ) {
      send(response, 403, "Forbidden");
      return;
    }
    await forward(
      request,
      response,
      `http://127.0.0.1:${target.port}${url.pathname}${url.search}`,
      (headers) => headers.set(INSPECTOR_TOKEN_HEADER, target.token),
      "Could not reach the workflow inspector.",
    );
  }

  /**
   * Pass `/app/*` to the app, so the extension's pages read it from the
   * dashboard's own origin. Only the dashboard's page may use it, as with the
   * API proxy. A credential for the dashboard itself is not passed on.
   */
  async function app(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const site = request.headers["sec-fetch-site"];
    const origin = request.headers.origin;
    if (
      (site !== undefined && site !== "same-origin") ||
      (origin !== undefined && origin !== `http://${request.headers.host}`)
    ) {
      send(response, 403, "Forbidden");
      return;
    }
    const appUrl = options.appUrl ?? options.store.apiSnapshot()?.appUrl;
    if (!appUrl) {
      send(response, 503, "The app is not running yet.");
      return;
    }
    // Framed by an extension's iframe page, and by nothing else.
    response.setHeader("content-security-policy", "frame-ancestors 'self'");
    response.setHeader("x-frame-options", "SAMEORIGIN");
    await forward(
      request,
      response,
      `${new URL(appUrl).origin}${url.pathname.slice(APP_PATH.length) || "/"}${url.search}`,
      (headers) => {
        if (access) headers.delete("authorization");
      },
      "Could not reach the app.",
    );
  }

  /** Send the request on to `target` and stream its answer back. */
  async function forward(
    request: IncomingMessage,
    response: ServerResponse,
    target: string,
    adjust: (headers: Headers) => void,
    unreachable: string,
  ): Promise<void> {
    const bodyless = request.method === "GET" || request.method === "HEAD";
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined || NOT_FORWARDED.has(name)) continue;
      if (name.startsWith("sec-")) continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    adjust(headers);
    const abort = new AbortController();
    response.on("close", () => abort.abort());
    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        redirect: "manual",
        signal: abort.signal,
        ...(bodyless
          ? {}
          : {
              body: Readable.toWeb(request) as unknown as BodyInit,
              duplex: "half",
            }),
      } as RequestInit);
      const returned: Record<string, string> = {};
      upstream.headers.forEach((value, name) => {
        if (!NOT_RETURNED.has(name)) returned[name] = value;
      });
      response.writeHead(upstream.status, returned);
      if (!upstream.body || request.method === "HEAD") {
        response.end();
        return;
      }
      await pipeline(Readable.fromWeb(upstream.body as never), response);
    } catch {
      if (response.headersSent) response.destroy();
      else send(response, 502, unreachable);
    }
  }

  async function proxy(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const site = request.headers["sec-fetch-site"];
    const origin = request.headers.origin;
    if (
      (site !== undefined && site !== "same-origin") ||
      (origin !== undefined && origin !== `http://${request.headers.host}`)
    ) {
      send(response, 403, "Forbidden");
      return;
    }
    let target: URL | undefined;
    try {
      target = new URL(url.searchParams.get("url") ?? "");
    } catch {
      // Not an address; refused below.
    }
    const appUrl = options.store.apiSnapshot()?.appUrl;
    if (!target || !appUrl || target.origin !== new URL(appUrl).origin) {
      send(
        response,
        403,
        "Only the app shown in the dashboard can be reached.",
      );
      return;
    }
    const body = await readBytes(request, MAX_PROXY_BYTES);
    if (!body) {
      send(response, 413, "Payload too large");
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined || NOT_FORWARDED.has(name)) continue;
      if (name.startsWith("sec-")) continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const cookie = url.searchParams.get("cookie");
    if (cookie) headers.set("cookie", cookie);
    const bodyless = request.method === "GET" || request.method === "HEAD";
    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: bodyless ? undefined : (body as BodyInit),
        redirect: "manual",
      });
      const returned: Record<string, string> = {};
      upstream.headers.forEach((value, name) => {
        if (!NOT_RETURNED.has(name)) returned[name] = value;
      });
      send(
        response,
        upstream.status,
        new Uint8Array(await upstream.arrayBuffer()),
        returned,
      );
    } catch {
      send(response, 502, "Could not reach the app.");
    }
  }

  function eventStream(request: IncomingMessage, response: ServerResponse) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      // So a proxy in front passes events on as they come.
      "x-accel-buffering": "no",
    });
    const write = (chunk: string) => {
      if (response.writableEnded || response.destroyed) return;
      response.write(chunk);
    };
    write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
    const unsubscribe = options.store.subscribe((event: DevTelemetryEvent) =>
      write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
    );
    // A rebuilt extension: the page reloads to run it.
    const unwatch = extension?.onChange(() =>
      write(
        `event: extension\ndata: ${JSON.stringify(snapshot().extension)}\n\n`,
      ),
    );
    const keepalive = setInterval(() => write(": keepalive\n\n"), KEEPALIVE_MS);
    request.on("close", () => {
      clearInterval(keepalive);
      unsubscribe();
      unwatch?.();
    });
  }

  // The first build finishes before the page can be asked for; a failed one
  // is shown on the page, and does not stop the dashboard.
  const ready = extension ? extension.load() : Promise.resolve();
  return ready.then(() => listen());

  function listen(): Promise<DevDashboard> {
    return new Promise((resolve, reject) => {
      server.once("error", (error) => {
        extension?.close();
        reject(
          new Error(
            production
              ? `Brick: dashboard port ${options.port} is unavailable. Set dashboard.port in brick() to another.`
              : `Brick: dashboard port ${options.port} is unavailable. Use --dashboard-port <number> or --no-dashboard.`,
            { cause: error },
          ),
        );
      });
      server.listen(options.port, host, () => {
        const address = server.address();
        const port =
          typeof address === "object" && address !== null
            ? address.port
            : options.port;
        allowedHosts = new Set([
          `127.0.0.1:${port}`,
          `localhost:${port}`,
          `[::1]:${port}`,
        ]);
        if (!production) extension?.watch();
        resolve({
          port,
          setPluginExtensions: (plugins) =>
            extension?.setPlugins(plugins) ?? Promise.resolve(),
          stop() {
            extension?.close();
            server.close();
            server.closeAllConnections();
          },
        });
      });
    });
  }
}

/** The whole request body, or undefined when it is larger than `limit`. */
function readBytes(
  request: IncomingMessage,
  limit: number,
): Promise<Uint8Array | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(undefined);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    request.on("error", () => resolve(undefined));
  });
}

function history(
  store: DevHistory,
  pathname: string,
  params: URLSearchParams,
  response: ServerResponse,
): void {
  const json = (body: unknown) =>
    send(response, 200, JSON.stringify(body), {
      "content-type": "application/json",
    });
  try {
    if (pathname === "/api/history") return json(store.info());
    if (pathname === "/api/history/summary") {
      return json(store.summary(parseHistoryQuery(params)));
    }
    if (pathname === "/api/history/traces") {
      return json(store.traces(parseHistoryQuery(params)));
    }
    if (pathname === "/api/history/facets") {
      return json(store.facets(parseHistoryQuery(params)));
    }
    if (pathname === "/api/history/volume") {
      return json(store.volume(parseHistoryQuery(params)));
    }
    if (pathname === "/api/history/export") {
      return send(response, 200, store.exportCsv(parseHistoryQuery(params)), {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="brick-requests.csv"',
        "cache-control": "no-store",
      });
    }
    const prefix = "/api/history/traces/";
    if (pathname.startsWith(prefix)) {
      const trace = store.trace(
        decodeURIComponent(pathname.slice(prefix.length)),
      );
      if (trace) return json(trace);
    }
    send(response, 404, "Not found");
  } catch {
    send(response, 500, "History query failed");
  }
}

const ASSET_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

function serveAsset(response: ServerResponse, name: string): void {
  // Plain file names only: no separators, so a request cannot leave the folder.
  if (!/^[\w.-]+$/.test(name) || name.startsWith(".")) {
    send(response, 404, "Not found");
    return;
  }
  const directory = assetsDirectory();
  if (!directory) {
    send(
      response,
      503,
      "Dashboard assets are missing. Build them with: bun run --filter @brickkit/cli build",
    );
    return;
  }
  readFile(join(directory, name)).then(
    (body) =>
      send(response, 200, body, {
        "content-type":
          ASSET_TYPES[extname(name)] ?? "application/octet-stream",
        "cache-control": "no-store",
      }),
    () => send(response, 404, "Not found"),
  );
}

function send(
  response: ServerResponse,
  status: number,
  body: string | Uint8Array,
  headers: Record<string, string | string[]> = {
    "content-type": "text/plain; charset=utf-8",
  },
): void {
  response.writeHead(status, headers);
  response.end(body);
}
