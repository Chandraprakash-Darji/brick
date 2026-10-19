import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveWorkflowPaths, type BrickApp } from "@brickkit/core";

interface Builders {
  StandaloneBuilder: new (config: Record<string, unknown>) => {
    build(): Promise<void>;
  };
  applySwcTransform(
    filename: string,
    source: string,
    mode: "step" | "workflow" | "detect" | false,
    absolutePath: string,
    projectRoot: string,
    moduleSpecifierRoot?: string,
  ): Promise<{ code: string }>;
}

type BunPlugin = Parameters<typeof Bun.plugin>[0];

const DIRECTIVE = /["']use (?:step|workflow)["']/;

/**
 * Every project source file. Not the generated bundle: it holds the directives as
 * text inside the SDK's own code and is already built.
 */
const TRANSFORMED = new RegExp(
  String.raw`^(?!.*(?:node_modules|\.well-known/workflow/)).*\.[cm]?[jt]sx?$`,
);

function loaderFor(path: string): "ts" | "tsx" | "js" | "jsx" {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".jsx")) return "jsx";
  return /\.[cm]?ts$/.test(path) ? "ts" : "js";
}

async function loadBuilders(root: string): Promise<Builders | undefined> {
  try {
    const path = createRequire(join(root, "package.json")).resolve(
      "@workflow/builders",
    );
    return (await import(pathToFileURL(path).href)) as Builders;
  } catch {
    return undefined;
  }
}

/**
 * The plugin that turns `"use workflow"` and `"use step"` files into workflows and
 * steps. `registerWorkflowTransform` installs it for the running process;
 * `brick build` hands it to `Bun.build`.
 *
 * @param root - The project root, where the SDK is installed. Default: the working directory.
 * @returns The plugin, or `undefined` when the Workflow SDK and its builders are not
 * installed in the project.
 */
export async function workflowTransformPlugin(
  root: string = process.cwd(),
): Promise<BunPlugin | undefined> {
  const projectRoot = resolve(root);
  const builders = await loadBuilders(projectRoot);
  if (!builders) return undefined;
  return {
    name: "brick:workflows",
    setup(build) {
      build.onLoad({ filter: TRANSFORMED }, async (args) => {
        const source = await readFile(args.path, "utf8");
        if (!DIRECTIVE.test(source))
          return { contents: source, loader: loaderFor(args.path) };
        const { code } = await builders.applySwcTransform(
          relative(projectRoot, args.path).replaceAll("\\", "/"),
          source,
          "step",
          args.path,
          projectRoot,
          projectRoot,
        );
        return { contents: code, loader: "js" };
      });
    },
  };
}

let installed = false;

/**
 * Make files marked `"use workflow"` or `"use step"` load as workflows and steps.
 *
 * A workflow function gets the `workflowId` that `defineListener({ workflow })`
 * needs, and a step registers itself so the runtime can run it in this process.
 * `brick dev`, `brick start` and `brick worker` call it before they load the app.
 * Call it in a script or test before importing the files, with the project root.
 *
 * It does nothing, and returns `false`, when the Workflow SDK and its builders are
 * not installed in the project. Bun allows plugins once per process, so a second
 * call is ignored.
 *
 * @param root - The project root, where the SDK is installed. Default: the working directory.
 * @returns Whether the transform is active.
 */
export async function registerWorkflowTransform(
  root: string = process.cwd(),
): Promise<boolean> {
  if (installed) return true;
  const plugin = await workflowTransformPlugin(root);
  if (!plugin) return false;
  installed = true;
  Bun.plugin(plugin);
  return true;
}

/**
 * Build the bundle that runs an app's workflows: `flow.mjs` and `manifest.json`
 * in `<root>/.well-known/workflow/v1`, from every file under `root` marked
 * `"use workflow"` or `"use step"`.
 *
 * `brick dev` and `brick start` call it before events start. Call it in a script
 * or test before starting events.
 *
 * @param options - `root`: the project root. Default: the working directory.
 * @throws When `@workflow/builders` is not installed in the project.
 */
export async function buildWorkflows(
  options: { root?: string } = {},
): Promise<void> {
  const { root, dir } = resolveWorkflowPaths(options);
  const builders = await loadBuilders(root);
  if (!builders)
    throw new Error(
      `Cannot build workflows: @workflow/builders is not installed in ${root}. Add it with: bun add -d @workflow/builders`,
    );
  const output = (name: string) =>
    `./${relative(root, join(dir, name)).replaceAll("\\", "/")}`;
  await new builders.StandaloneBuilder({
    buildTarget: "standalone",
    dirs: ["."],
    workingDir: root,
    stepsBundlePath: output("__step_registrations.mjs"),
    workflowsBundlePath: output("flow.mjs"),
    webhookBundlePath: output("webhook.mjs"),
    suppressCreateWorkflowsBundleLogs: true,
    suppressCreateWebhookBundleLogs: true,
    suppressCreateManifestLogs: true,
  }).build();
}

/**
 * Build the workflow bundle an app needs, if it has workflow listeners.
 *
 * @param app - The loaded app.
 * @returns Whether a bundle was built.
 */
export async function buildAppWorkflows(app: BrickApp): Promise<boolean> {
  const target = app.events?.workflows;
  if (!target) return false;
  const started = performance.now();
  await buildWorkflows({ root: target.root });
  console.log(
    `[Brick-TS] Built workflows in ${Math.round(performance.now() - started)}ms`,
  );
  return true;
}
