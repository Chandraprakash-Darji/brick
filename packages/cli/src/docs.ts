import { Elysia, type Context } from "elysia";

export interface ReferenceOptions {
  path?: string;
  title?: string;
  specUrl?: string;
}

import { scalarDocsHTML } from "./docs-html";
export { scalarDocsHTML } from "./docs-html";

/** Standalone Elysia plugin serving GET <path> with the Scalar HTML page. */
export function referencePlugin(opts: ReferenceOptions = {}): Elysia {
  const path = opts.path ?? "/reference";
  const title = opts.title ?? "Brick-TS API Mesh";
  const specUrl = opts.specUrl ?? "/openapi.json";
  const plugin = new Elysia();
  plugin.get(path, ({ set }: Context) => {
    set.headers["content-type"] = "text/html; charset=utf-8";
    return scalarDocsHTML(specUrl, title);
  });
  return plugin;
}

/** Mounts the Scalar reference route onto an existing app. */
export function registerReferenceRoute(
  app: Elysia,
  opts: ReferenceOptions = {}
): Elysia {
  return app.use(referencePlugin(opts)) as Elysia;
}
