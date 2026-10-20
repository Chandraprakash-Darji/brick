import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrickApp } from "@brickkit/core";

/** Where the dashboard serves the inspector. */
export const INSPECTOR_PATH = "/workflows";
/** The header that proves a request comes from the dashboard. */
export const INSPECTOR_TOKEN_HEADER = "x-brick-inspector";

export interface Inspector {
  readonly port: number;
  /** Every request must carry it in `INSPECTOR_TOKEN_HEADER`. */
  readonly token: string;
  stop(): void;
}

/**
 * Serve the Workflow inspector (`@brickkit/workflow-inspector`, the Workflow
 * SDK's observability UI) for the app's world, on a loopback port of its own.
 * The dashboard proxies it at `/workflows`; it is the only caller that knows the
 * token. The UI can cancel runs and resume hooks, so nothing else may reach it,
 * and it exists only under `brick dev`.
 *
 * @param app - The loaded app, running in this process.
 * @returns The inspector, or `undefined` when the app runs no workflows or the
 * project does not have `@brickkit/workflow-inspector` installed.
 */
export async function startInspector(
  app: BrickApp,
): Promise<Inspector | undefined> {
  const target = app.events?.workflows;
  if (!target) return undefined;
  let handlerPath: string;
  try {
    handlerPath = createRequire(join(target.root, "package.json")).resolve(
      "@brickkit/workflow-inspector/handler",
    );
  } catch {
    // The Workflows view says how to install it.
    return undefined;
  }
  const { createInspectorHandler } = (await import(
    pathToFileURL(handlerPath).href
  )) as {
    createInspectorHandler(options: {
      basename: string;
      world: unknown;
      manifestPath: string;
    }): Promise<(request: Request) => Promise<Response>>;
  };
  const handle = await createInspectorHandler({
    basename: INSPECTOR_PATH,
    world: target.world,
    manifestPath: join(target.dir, "manifest.json"),
  });
  const token = randomBytes(16).toString("hex");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    // The UI streams a run's output and holds the connection open.
    idleTimeout: 0,
    fetch: (request) =>
      request.headers.get(INSPECTOR_TOKEN_HEADER) === token
        ? handle(request)
        : new Response("Forbidden", { status: 403 }),
  });
  return { port: server.port!, token, stop: () => void server.stop(true) };
}
