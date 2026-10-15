import { resolve } from "node:path";
import { writeContractSource } from "./client-contract-file";
import {
  createServer,
  isRunnableDevEnvironment,
  normalizePath,
  type Plugin,
  type ResolvedConfig,
  type EnvironmentModuleNode,
} from "vite";
import { generateClientContract } from "./client-contract";
import { requireBrickApp } from "./app-entry";
import { ModuleRunner } from "vite/module-runner";

export interface BrickClientPluginOptions {
  /** Any module whose default export is a BrickApp; do not call listen() there. */
  entry: string;
  /** Generated browser contract, relative to the Vite root (default _brick/contract.ts). */
  output?: string;
}

/** Load a BrickApp through Vite's server module graph, including dependency HMR. */
export function brickClient(options: BrickClientPluginOptions): Plugin {
  const virtualId = "virtual:brick-app";
  const resolvedId = "\0" + virtualId;
  let entry: string;
  let output: string;
  let config: ResolvedConfig;
  let buildGeneration: Promise<void> | undefined;
  let runner: ModuleRunner | undefined;
  let reload = Promise.resolve();
  const dependencies = new Set<string>();
  let revision = 0;
  const changedFiles = new Set<string>();

  async function writeContract(value: unknown) {
    const source = generateClientContract(requireBrickApp(value));
    await writeContractSource(output, source);
  }

  function collectDependencies(
    node: EnvironmentModuleNode | undefined,
    seen = new Set<EnvironmentModuleNode>(),
  ) {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (node.file) dependencies.add(node.file);
    for (const imported of node.importedModules)
      collectDependencies(imported, seen);
  }

  return {
    name: "brick:client",
    enforce: "pre",
    configResolved(resolved) {
      config = resolved;
      entry = normalizePath(resolve(config.root, options.entry));
      output = normalizePath(
        resolve(config.root, options.output ?? "_brick/contract.ts"),
      );
      if (entry === output)
        throw new Error(
          "Brick: contract output must not overwrite the app entry.",
        );
    },
    async configureServer(server) {
      const environment = server.environments.ssr;
      if (!environment)
        throw new Error(
          "Brick: client generation requires a Vite SSR environment.",
        );
      // Frameworks such as Start own their SSR runner. Use an independent runner
      // on the same transform graph to read app metadata without changing theirs.
      runner = new ModuleRunner({
        hmr: false,
        transport: {
          invoke: (payload) => environment.hot.handleInvoke(payload),
        },
      });
      await writeContract((await runner.import(entry)).default);
      dependencies.clear();
      collectDependencies(environment.moduleGraph.getModuleById(entry));
      dependencies.add(entry);
    },
    async hotUpdate(context) {
      if (
        this.environment.name !== "ssr" ||
        !dependencies.has(context.file) ||
        context.file === output
      )
        return;
      if (!runner) return;
      const currentRunner = runner;
      const currentRevision = ++revision;
      changedFiles.add(context.file);
      reload = reload
        .catch(() => {})
        .then(async () => {
          await new Promise((done) => setTimeout(done, 30));
          if (currentRevision !== revision) return;
          for (const module of context.modules)
            this.environment.moduleGraph.invalidateModule(module);
          const graph = currentRunner.evaluatedModules;
          const seen = new Set<string>();
          const invalidate = (id: string) => {
            if (seen.has(id)) return;
            seen.add(id);
            const node = graph.getModuleById(id);
            if (!node) return;
            for (const importer of node.importers) invalidate(importer);
            // Registration modules mutate imported services. Reevaluate their
            // dependencies too so removed actions cannot survive in a singleton.
            for (const imported of node.imports) invalidate(imported);
            graph.invalidateModule(node);
          };
          for (const file of changedFiles) {
            for (const node of graph.getModulesByFile(file) ?? [])
              invalidate(node.id);
          }
          changedFiles.clear();
          invalidate(entry);
          try {
            await writeContract((await currentRunner.import(entry)).default);
          } finally {
            collectDependencies(
              this.environment.moduleGraph.getModuleById(entry),
            );
          }
          dependencies.clear();
          collectDependencies(
            this.environment.moduleGraph.getModuleById(entry),
          );
          dependencies.add(entry);
        });
      await reload;
    },
    async closeBundle() {
      await runner?.close();
    },
    async buildStart() {
      if (config.command !== "build") return;
      buildGeneration ??= (async () => {
        // Evaluate the server entry through Vite's TS/alias resolver before client compilation.
        // This loader has no app plugins, so it cannot recursively trigger generation.
        const loader = await createServer({
          configFile: false,
          root: config.root,
          mode: config.mode,
          envDir: config.envDir,
          base: config.base,
          define: config.define,
          logLevel: "silent",
          resolve: { alias: config.resolve.alias },
          ssr: config.ssr,
          server: { middlewareMode: true, watch: null },
        });
        try {
          const environment = loader.environments.ssr;
          if (!environment || !isRunnableDevEnvironment(environment))
            throw new Error("Brick: missing build-time SSR loader.");
          await writeContract((await environment.runner.import(entry)).default);
        } finally {
          await loader.close();
        }
      })();
      await buildGeneration;
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
