import { resolve } from "node:path";
import type { Plugin } from "vite";

export interface BrickClientPluginOptions {
  /** Any module whose default export is a BrickApp; do not call listen() there. */
  entry: string;
}

/** Load a BrickApp through Vite's server module graph, including dependency HMR. */
export function brickClient(options: BrickClientPluginOptions): Plugin {
  const virtualId = "virtual:brick-app";
  const resolvedId = "\0" + virtualId;
  let entry: string;
  return {
    name: "brick:client",
    enforce: "pre",
    configResolved(config) {
      entry = resolve(config.root, options.entry);
    },
    resolveId(id) {
      if (id !== virtualId) return;
      if (this.environment.config.consumer === "client") {
        throw new Error(
          "Brick: virtual:brick-app is server-only; never import the backend app in the browser.",
        );
      }
      return resolvedId;
    },
    load(id) {
      if (id !== resolvedId) return;
      return `import app from ${JSON.stringify(entry)};
if (!app || typeof app.fetch !== "function" || typeof app.endpoint !== "function") {
  throw new Error("Brick: the entry module must default-export a BrickApp created by brick().");
}
export default app;
`;
    },
  };
}
