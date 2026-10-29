import { existsSync, watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleComponents } from "./dev-docs";

/*
 * The dashboard's extension: one module of the project's own, built with the
 * dashboard's React and UI kit left external (the page's import map hands it
 * the dashboard's copies), and its Tailwind classes compiled against the
 * dashboard's theme.css. Plus the theme, which needs no code at all.
 */

/** Token values for the dashboard's light and dark themes, its radius and fonts. */
export interface DashboardTheme {
  /** Colour tokens in light mode, by name: `{ primary: "oklch(0.55 0.2 260)" }`. */
  light?: Record<string, string>;
  /** Colour tokens in dark mode. */
  dark?: Record<string, string>;
  /** The base corner radius, such as `"0.5rem"`. */
  radius?: string;
  /** CSS font stacks. The page must be able to load the font. */
  fonts?: { sans?: string; mono?: string };
}

/** What `dashboard` accepts wherever the dashboard starts or is built. */
export interface DashboardExtensionOptions {
  /**
   * A module whose default export is `defineDashboard({ ... })`, or the
   * `dashboard` folder `brick build` wrote it to.
   */
  extension?: string;
  theme?: DashboardTheme;
}

/** The colour tokens of `dashboard/theme.css`; a test keeps the two in step. */
export const THEME_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "positive",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "span-request",
  "span-action",
  "span-rpc",
  "span-sql",
  "span-event",
  "span-other",
] as const;

const THEME_KEYS = new Set(["light", "dark", "radius", "fonts"]);
const FONT_KEYS = new Set(["sans", "mono"]);
const TOKENS = new Set<string>(THEME_TOKENS);

/** A value that cannot close the rule it sits in. */
function cssValue(where: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim() || /[;{}<>\\]/.test(value))
    throw new Error(
      `Brick: dashboard.theme.${where} must be a CSS value without ; { } < > or \\.`,
    );
  return value.trim();
}

/**
 * The stylesheet for a theme, loaded after the dashboard's own; empty when the
 * theme sets nothing. Throws on a token name theme.css does not have.
 */
export function themeCss(theme: DashboardTheme | undefined): string {
  if (!theme) return "";
  for (const key of Object.keys(theme))
    if (!THEME_KEYS.has(key))
      throw new Error(
        `Brick: dashboard.theme has no "${key}". It takes light, dark, radius and fonts.`,
      );
  const rules: string[] = [];
  const root: string[] = [];
  if (theme.radius !== undefined)
    root.push(`--radius: ${cssValue("radius", theme.radius)};`);
  for (const [name, value] of Object.entries(theme.fonts ?? {})) {
    if (!FONT_KEYS.has(name))
      throw new Error(
        `Brick: dashboard.theme.fonts has no "${name}". It takes sans and mono.`,
      );
    root.push(`--font-${name}: ${cssValue(`fonts.${name}`, value)};`);
  }
  if (root.length) rules.push(`:root {\n  ${root.join("\n  ")}\n}`);
  // theme.css sets light on :root and dark on .dark, both on <html>; these
  // selectors win over both, and each applies only in its own mode.
  for (const [mode, selector] of [
    ["light", ":root:not(.dark)"],
    ["dark", ":root.dark"],
  ] as const) {
    const tokens = theme[mode];
    if (!tokens) continue;
    const lines = Object.entries(tokens).map(([name, value]) => {
      if (!TOKENS.has(name))
        throw new Error(
          `Brick: dashboard.theme.${mode} has no token "${name}". Tokens: ${THEME_TOKENS.join(", ")}.`,
        );
      return `--${name}: ${cssValue(`${mode}.${name}`, value)};`;
    });
    if (lines.length) rules.push(`${selector} {\n  ${lines.join("\n  ")}\n}`);
  }
  return rules.length ? `${rules.join("\n")}\n` : "";
}

/** The built React app, next to `src/` in the repo and next to `dist/` when published. */
export function assetsDirectory(): string | undefined {
  for (const relative of ["../dashboard-dist/", "../../dashboard-dist/"]) {
    const directory = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(join(directory, "app.js"))) return directory;
  }
  return undefined;
}

export interface BuiltExtension {
  js: string;
  /** The extension's own Tailwind classes; empty when it uses none. */
  css: string;
}

let warnedTailwind = false;

/**
 * Tailwind for the classes in the extension's bundle, compiled against the
 * dashboard's theme.css so `bg-primary` and the rest match. Only utilities are
 * emitted: the dashboard's stylesheet already has the base styles and tokens.
 * Tailwind is an optional peer, found from the project first.
 */
async function extensionCss(
  entry: string,
  js: string,
  warn: (message: string) => void,
): Promise<string> {
  let tailwind: string | undefined;
  let main: string | undefined;
  for (const from of [entry, fileURLToPath(import.meta.url)]) {
    try {
      const require = createRequire(from);
      tailwind = require.resolve("tailwindcss/package.json");
      main = require.resolve("tailwindcss");
      break;
    } catch {
      // Not installed there.
    }
  }
  const assets = assetsDirectory();
  const themeFile = assets
    ? join(assets, "theme.css")
    : fileURLToPath(new URL("../dashboard/theme.css", import.meta.url));
  if (!tailwind || !main) {
    if (!warnedTailwind)
      warn(
        "[Brick-TS] tailwindcss is not installed, so the dashboard extension's own Tailwind classes are not compiled. The UI kit is styled either way.",
      );
    warnedTailwind = true;
    return "";
  }
  const root = dirname(tailwind);
  const { compile } = (await import(
    pathToFileURL(main).href
  )) as typeof import("tailwindcss");
  const compiler = await compile(
    `@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" theme(reference inline);
@import "tailwindcss/utilities.css" layer(utilities);
@reference "brick/theme.css";
`,
    {
      base: root,
      async loadStylesheet(id) {
        const path =
          id === "brick/theme.css"
            ? themeFile
            : join(root, id.replace(/^tailwindcss\//, ""));
        return {
          path,
          base: dirname(path),
          content: await readFile(path, "utf8"),
        };
      },
    },
  );
  // Every word in the bundle is a candidate; Tailwind ignores what is not a class.
  const candidates = new Set(js.split(/[\s"'`]+/).filter(Boolean));
  const css = compiler.build([...candidates]);
  return /\{/.test(css) ? css : "";
}

/** Bundle the extension and its styles for the dashboard page. */
export async function buildDashboardExtension(
  entry: string,
  options: { warn?: (message: string) => void } = {},
): Promise<BuiltExtension> {
  const js = await bundleComponents(entry);
  return {
    js,
    css: await extensionCss(
      entry,
      js,
      options.warn ?? ((message) => console.warn(message)),
    ),
  };
}

/** Write the built extension into `outdir`, where `brick start` can serve it. */
export async function writeDashboardExtension(
  entry: string,
  outdir: string,
): Promise<void> {
  const built = await buildDashboardExtension(entry);
  await mkdir(outdir, { recursive: true });
  await writeFile(join(outdir, "extension.js"), built.js);
  await writeFile(join(outdir, "extension.css"), built.css);
}

/**
 * The extension as the dashboard serves it. From source it is built here, and
 * rebuilt as its folder changes when watching; from a `brick build` folder it
 * is read as it is. A failed build keeps the error to show on the page.
 */
export class DashboardExtensionHost {
  readonly #path: string;
  readonly #warn: (message: string) => void;
  readonly #listeners = new Set<() => void>();
  #watcher: FSWatcher | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending: Promise<void> = Promise.resolve();
  revision = 0;
  built: BuiltExtension | undefined;
  error: string | undefined;

  constructor(path: string, warn: (message: string) => void) {
    this.#path = resolve(path);
    this.#warn = warn;
  }

  load(): Promise<void> {
    this.#pending = this.#pending.then(async () => {
      const before = JSON.stringify([this.built, this.error]);
      try {
        const prebuilt = join(this.#path, "extension.js");
        if (existsSync(prebuilt)) {
          const css = join(this.#path, "extension.css");
          this.built = {
            js: await readFile(prebuilt, "utf8"),
            css: existsSync(css) ? await readFile(css, "utf8") : "",
          };
        } else {
          if (!existsSync(this.#path))
            throw new Error(
              `Brick: the dashboard extension ${this.#path} does not exist.`,
            );
          this.built = await buildDashboardExtension(this.#path, {
            warn: this.#warn,
          });
        }
        this.error = undefined;
      } catch (error) {
        this.built = undefined;
        this.error = error instanceof Error ? error.message : String(error);
        this.#warn(`[Brick-TS] Dashboard extension: ${this.error}`);
      }
      // The folder may hold the app too; its changes leave the bundle as it was.
      if (JSON.stringify([this.built, this.error]) === before) return;
      this.revision++;
      for (const listener of this.#listeners) listener();
    });
    return this.#pending;
  }

  /** Rebuild when a file in the extension's folder changes. */
  watch(): void {
    try {
      this.#watcher = watch(
        dirname(this.#path),
        { recursive: true },
        (_event, file) => {
          if (file && /(^|[\\/])(node_modules|\.)/.test(file)) return;
          clearTimeout(this.#timer);
          this.#timer = setTimeout(() => void this.load(), 100);
        },
      );
    } catch {
      // A folder that cannot be watched still works; it needs a restart.
    }
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  close(): void {
    clearTimeout(this.#timer);
    this.#watcher?.close();
    this.#listeners.clear();
  }
}
