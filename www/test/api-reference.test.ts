import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Project } from "ts-morph";
import { ENTRY_POINTS } from "../scripts/api-reference/entries";
import { extractExports } from "../scripts/api-reference/extract";
import {
  anchorOf,
  buildSymbolIndex,
  linkTypes,
  proseToMdx,
  renderEntry,
  renderIndex,
  renderMeta,
  summaryOf,
  type EntryPage,
} from "../scripts/api-reference/render";

function symbolsOf(source: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true },
  });
  const file = project.createSourceFile("/repo/pkg/src/index.ts", source);
  return extractExports(file, "/repo");
}

const SOURCE = `
/**
 * Adds numbers, see {@link other}.
 *
 * Works with Array<T> and {braces} in prose, and \`{ code }\` too.
 *
 * ## A heading
 * Text after it.
 *
 * @param a - the first
 * @param b - the second, defaults to two
 * @returns the sum
 * @throws {Error} when it overflows
 * @example
 * add(1, 2); // 3
 */
export function add(a: number, b = 2): number {
  return a + b;
}
export function other(): void {}

export function over(a: string): string;
export function over(a: number): number;
export function over(a: any) {
  return a;
}

/** Counts. @deprecated use add */
export const sum = (x: number[]) => x.length;

/** The limit. */
export const LIMIT: number = 10;

/** Settings. */
export interface Config<T = string> extends Base {
  /** The port.
   * @default 80 */
  port?: number;
  readonly name: T;
  /** Runs it. */
  run(arg: string): void;
}
interface Base { id: string }

export type Id = string | number;
export type Shape = {
  /** Width. */
  width: number;
  height?: number;
};

/** A box. */
export class Box<T> {
  /** The value. */
  value: T;
  private secret = 1;
  constructor(value: T) {
    this.value = value;
  }
  /** Maps it. */
  map<U>(f: (value: T) => U): Box<U> {
    return new Box(f(this.value));
  }
  static of(n: number) {
    return new Box(n);
  }
}

export enum Color {
  /** The red one. */
  Red = "red",
}

/** @internal */
export function hidden() {}

export { add as plus };
`;

describe("extractExports", () => {
  const symbols = symbolsOf(SOURCE);
  const named = (name: string) =>
    symbols.find((symbol) => symbol.name === name)!;

  it("lists every export, by the name it is exported under, and not what is internal", () => {
    expect(symbols.map((symbol) => symbol.name).sort()).toEqual(
      [
        "Box",
        "Color",
        "Config",
        "Id",
        "LIMIT",
        "Shape",
        "add",
        "other",
        "over",
        "plus",
        "sum",
      ].sort(),
    );
  });

  it("reads a function's JSDoc: description, parameters, result, throws, example", () => {
    const add = named("add");
    expect(add.kind).toBe("function");
    expect(add.description).toContain("Adds numbers, see {@link other}.");
    expect(add.returns).toBe("the sum");
    expect(add.throws).toEqual(["`Error` when it overflows"]);
    expect(add.examples).toEqual(["add(1, 2); // 3"]);
    expect(add.signatures).toHaveLength(1);
    expect(add.signatures[0]!.text).toBe(
      "function add(a: number, b = 2): number",
    );
    expect(add.signatures[0]!.parameters).toEqual([
      { name: "a", type: "number", optional: false, description: "the first" },
      {
        name: "b",
        type: "number",
        optional: true,
        description: "the second, defaults to two",
        default: "2",
      },
    ]);
    expect(add.source).toEqual({ path: "pkg/src/index.ts", line: 17 });
  });

  it("shows each overload and takes the description from whichever has it", () => {
    expect(named("over").signatures.map((s) => s.text)).toEqual([
      "function over(a: string): string",
      "function over(a: number): number",
    ]);
  });

  it("treats an arrow function in a const as a function, with the const's JSDoc", () => {
    const sum = named("sum");
    expect(sum.kind).toBe("function");
    expect(sum.deprecated).toBe("use add");
    expect(sum.signatures[0]!.returnType).toBe("number");
    expect(named("LIMIT")).toMatchObject({
      kind: "variable",
      description: "The limit.",
      text: "const LIMIT: number",
    });
  });

  it("lists an interface's members with their docs, defaults, and optional marks", () => {
    const config = named("Config");
    expect(config.kind).toBe("interface");
    expect(config.text).toBe("interface Config<T = string> extends Base");
    expect(
      config.members.map((m) => [m.name, m.kind, m.optional, m.readonly]),
    ).toEqual([
      ["port", "property", true, false],
      ["name", "property", false, true],
      ["run", "method", false, false],
    ]);
    expect(config.members[0]).toMatchObject({
      description: "The port.",
      default: "80",
      type: "number",
    });
    expect(config.members[2]!.type).toBe("run(arg: string): void");
  });

  it("reads a class's public members and leaves private ones out", () => {
    const box = named("Box");
    expect(box.kind).toBe("class");
    expect(box.text).toBe("class Box<T>");
    expect(box.members.map((m) => [m.kind, m.name, m.static])).toEqual([
      ["property", "value", false],
      ["constructor", "constructor", false],
      ["method", "map", false],
      ["method", "of", true],
    ]);
    expect(box.members[2]!.type).toBe("map<U>(f: (value: T) => U): Box<U>");
  });

  it("reads type aliases, object-shaped ones with their fields, and enums", () => {
    expect(named("Id").text).toBe("type Id = string | number;");
    expect(named("Shape").members.map((m) => m.name)).toEqual([
      "width",
      "height",
    ]);
    expect(named("Shape").members[0]!.description).toBe("Width.");
    expect(named("Color").members).toMatchObject([
      { name: "Red", type: "red", description: "The red one." },
    ]);
  });

  it("gives a re-export under its alias", () => {
    expect(named("plus").kind).toBe("function");
    expect(named("plus").signatures[0]!.text).toContain("function plus(");
  });
});

describe("extractExports across packages", () => {
  it("marks what comes from another package of the repository as a re-export", () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { strict: true },
    });
    project.createSourceFile(
      "/repo/packages/b/src/index.ts",
      "/** Made in b. */ export function fromB(): void {}",
    );
    const entry = project.createSourceFile(
      "/repo/packages/a/src/index.ts",
      `export { fromB } from "../../b/src/index";
       export function own(): void {}`,
    );
    const symbols = extractExports(entry, "/repo");
    expect(symbols.find((s) => s.name === "fromB")).toMatchObject({
      external: "@brickkit/b",
    });
    expect(symbols.find((s) => s.name === "fromB")?.source).toBeUndefined();
    expect(symbols.find((s) => s.name === "own")?.external).toBeUndefined();
  });
});

describe("proseToMdx", () => {
  const anchors = new Map([["other", "#other"]]);

  it("makes links, and leaves code and fences as written", () => {
    expect(proseToMdx("See {@link other} and {@link nowhere}.", anchors)).toBe(
      "See [`other`](#other) and `nowhere`.",
    );
    expect(proseToMdx("{@link https://x.dev docs}")).toBe(
      "[docs](https://x.dev)",
    );
    expect(proseToMdx("{@link other | the other}", anchors)).toBe(
      "[`the other`](#other)",
    );
  });

  it("escapes what MDX would read as code, outside code only", () => {
    expect(proseToMdx("Array<T> and {braces} & more `a<b>{c}` ok")).toBe(
      "Array&lt;T> and \\{braces\\} &amp; more `a<b>{c}` ok",
    );
    expect(proseToMdx("```ts\nconst a = <T>{x};\n```\nafter {y}")).toBe(
      "```ts\nconst a = <T>{x};\n```\nafter \\{y\\}",
    );
  });

  it("turns headings into bold text so they stay out of the page's contents", () => {
    expect(
      proseToMdx("Intro\n\n## Result / error\nText\n```md\n# kept\n```"),
    ).toBe("Intro\n\n**Result / error**\nText\n```md\n# kept\n```");
  });

  it("does not take a ``` inside a longer fence for its end", () => {
    const text = "````md\n```ts\nx\n```\n````\n{after}";
    expect(proseToMdx(text)).toBe("````md\n```ts\nx\n```\n````\n\\{after\\}");
  });
});

describe("links between types", () => {
  const entries: EntryPage[] = [
    {
      slug: "a",
      specifier: "pkg/a",
      description: "A.",
      symbols: symbolsOf(`
        export interface Service<A, B> { a: A; b: B }
        export type Handler = () => void;
        export function build(): void {}
        export const value = 1;
      `),
    },
    {
      slug: "b",
      specifier: "pkg/b",
      description: "B.",
      symbols: symbolsOf(`
        export interface Options { service: unknown }
        export function use(service: unknown, options: unknown): void {}
      `),
    },
  ];
  const index = buildSymbolIndex(entries);
  const links = (current: string) => {
    const types = new Map<string, string>();
    for (const [name, locations] of index) {
      const home = locations.find((l) => l.slug === current) ?? locations[0]!;
      if (home.kind === "interface" || home.kind === "type")
        types.set(
          name,
          home.slug === current
            ? `#${home.anchor}`
            : `/docs/api-reference/${home.slug}#${home.anchor}`,
        );
    }
    return { hrefs: new Map(), types };
  };

  it("makes a type's name a link to its section, and leaves the rest as code", () => {
    expect(linkTypes("Service<any, any>[]", links("a"))).toBe(
      "[`Service`](#service)`<any, any>[]`",
    );
    expect(linkTypes("readonly Handler[]", links("a"))).toBe(
      "`readonly` [`Handler`](#handler)`[]`",
    );
    expect(linkTypes("Map<string, Service<A, B>>", links("a"))).toBe(
      "`Map<string,` [`Service`](#service)`<A, B>>`",
    );
  });

  it("links to the page that has the type when it is on another", () => {
    expect(linkTypes("Options | Service<1, 2>", links("b"))).toBe(
      "[`Options`](#options) \\| [`Service`](/docs/api-reference/a#service)`<1, 2>`",
    );
  });

  it("leaves alone what is not a type of this reference, a property name, a string, or the type itself", () => {
    expect(linkTypes("string | undefined", links("a"))).toBe(
      "`string \\| undefined`",
    );
    expect(linkTypes("build", links("a"))).toBe("`build`");
    expect(linkTypes("{ Service: number }", links("a"))).toBe(
      "`{ Service: number }`",
    );
    expect(linkTypes('"Service" | Elysia.Service', links("a"))).toBe(
      '`"Service" \\| Elysia.Service`',
    );
    expect(linkTypes("Service", { ...links("a"), self: "Service" })).toBe(
      "`Service`",
    );
    expect(linkTypes("", links("a"))).toBe("");
  });

  it("renders linked types in a page's tables, and {@link}s across pages", () => {
    const page = renderEntry(
      entries[1]!,
      { url: "https://x", branch: "main" },
      index,
    );
    expect(page).toContain("| `service` | `unknown` |  |");
    const own: EntryPage = {
      slug: "b",
      specifier: "pkg/b",
      description: "B.",
      symbols: symbolsOf(`
          /** Uses {@link Service} from the other page. */
          export function use(service: Service<1, 2>, options: Options): Service<1, 2> {
            return service;
          }
          export interface Service<A, B> { a: A; b: B }
          export interface Options { x: number }
        `),
    };
    const linked = renderEntry(
      own,
      { url: "https://x", branch: "main" },
      buildSymbolIndex([entries[0]!, own]),
    );
    // Both are on this page: its own sections win over the other page's.
    expect(linked).toContain(
      "| `service` | [`Service`](#service)`<1, 2>` |  |",
    );
    expect(linked).toContain("| `options` | [`Options`](#options) |  |");
    expect(linked).toContain("**Returns** [`Service`](#service)`<1, 2>`");
    expect(linked).toContain("Uses [`Service`](#service) from the other page.");
  });
});

describe("summaryOf and anchorOf", () => {
  it("takes the first sentence of the first paragraph, without markup", () => {
    expect(summaryOf("Adds {@link other} numbers. More.\n\nSecond.")).toBe(
      "Adds other numbers.",
    );
    expect(summaryOf("A [link](https://x.dev) here")).toBe("A link here");
    expect(summaryOf("")).toBe("");
    expect(summaryOf("x".repeat(300))).toHaveLength(160);
  });

  it("matches the ids Fumadocs gives headings", () => {
    expect(anchorOf("createSQLiteDatabase")).toBe("createsqlitedatabase");
    expect(anchorOf("$ref")).toBe("ref");
    expect(anchorOf("a_b")).toBe("a_b");
  });
});

describe("renderEntry", () => {
  const entry: EntryPage = {
    slug: "pkg",
    specifier: "pkg/sub",
    description: "A package.",
    symbols: symbolsOf(SOURCE).concat({
      name: "eq",
      kind: "function",
      description: "From elsewhere.",
      examples: [],
      throws: [],
      see: [],
      signatures: [],
      members: [],
      external: "drizzle-orm",
    }),
  };
  const page = renderEntry(entry, {
    url: "https://github.com/o/r",
    branch: "main",
  });

  it("has frontmatter, an intro with counts, and sections in order", () => {
    expect(page.startsWith("---\n# Generated by")).toBe(true);
    expect(page).toContain('title: "pkg/sub"');
    expect(page).toContain(
      "`pkg/sub` exports 11 names: 5 functions, 1 class, 1 interface, 2 types, 1 enum, 1 variable.",
    );
    expect(page).toContain("It also re-exports 1 from `drizzle-orm`.");
    expect(page).toContain('import { add, Box, Color } from "pkg/sub";');
    const order = [
      "## Functions",
      "## Classes",
      "## Interfaces",
      "## Types",
      "## Enums",
      "## Variables",
      "## Re-exported from drizzle-orm",
    ].map((h) => page.indexOf(h));
    expect(order.every((at, i) => at > (order[i - 1] ?? -1))).toBe(true);
  });

  it("renders a function: signature, description, parameters, returns, throws, example, source", () => {
    const section = page.slice(
      page.indexOf("### add\n"),
      page.indexOf("### other\n"),
    );
    expect(section).toContain(
      "```ts\nfunction add(a: number, b = 2): number\n```",
    );
    expect(section).toContain("Adds numbers, see [`other`](#other).");
    expect(section).toContain("Array&lt;T> and \\{braces\\}");
    expect(section).toContain("**A heading**");
    expect(section).toContain("| `a` | `number` | the first |");
    expect(section).toContain(
      "| `b?` | `number` default `2` | the second, defaults to two |",
    );
    expect(section).toContain("**Returns** `number` — the sum");
    expect(section).toContain("**Throws**\n\n- `Error` when it overflows");
    expect(section).toContain("**Example**\n\n```ts\nadd(1, 2); // 3\n```");
    expect(section).toContain(
      "[pkg/src/index.ts:17](https://github.com/o/r/blob/main/pkg/src/index.ts#L17)",
    );
  });

  it("lists functions in a table at the top of their section, and re-exports in one", () => {
    expect(page).toContain("| [`add`](#add) | Adds numbers, see other. |");
    expect(page).toContain("| `eq` | function | From elsewhere. |");
    expect(page).not.toContain("### eq");
  });

  it("renders members as tables and marks deprecation", () => {
    expect(page).toContain("| `port?` | `number` | The port. Default: `80` |");
    expect(page).toContain("| `readonly name` | `T` |  |");
    expect(page).toContain("| `static of` |");
    expect(page).toContain("> **Deprecated.** use add");
    expect(page).toContain("| `Red` | `red` | The red one. |");
  });

  it("is plain Markdown: nothing in it for MDX to take as a component or expression", () => {
    const outsideCode = page
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]*`/g, "");
    expect(outsideCode).not.toMatch(/<[A-Za-z/]/);
    expect(outsideCode.replace(/\\[{}]/g, "")).not.toMatch(/[{}]/);
  });
});

describe("renderIndex and renderMeta", () => {
  const entries: EntryPage[] = [
    { slug: "a", specifier: "@x/a", description: "A.", symbols: [] },
    { slug: "a-sub", specifier: "@x/a/sub", description: "Sub.", symbols: [] },
    { slug: "b", specifier: "@x/b", description: "B.", symbols: [] },
  ];

  it("links every entry point, and groups them by package in the sidebar", () => {
    const index = renderIndex(entries);
    expect(index).toContain("[`@x/a/sub`](/docs/api-reference/a-sub)");
    expect(JSON.parse(renderMeta(entries))).toMatchObject({
      title: "API Reference",
      root: true,
      pages: ["index", "---@x/a---", "a", "a-sub", "---@x/b---", "b"],
    });
  });
});

describe("the entry points", () => {
  const root = join(import.meta.dir, "../..");

  it("cover every subpath each package publishes", () => {
    for (const pkg of ["core", "cli", "crud"]) {
      const manifest = JSON.parse(
        readFileSync(join(root, "packages", pkg, "package.json"), "utf8"),
      ) as { name: string; exports: Record<string, unknown> };
      for (const subpath of Object.keys(manifest.exports)) {
        // Ambient declarations for `import.meta`, not an API.
        if (subpath === "./vite/client") continue;
        const specifier =
          subpath === "."
            ? manifest.name
            : `${manifest.name}/${subpath.slice(2)}`;
        expect(ENTRY_POINTS.map((e) => e.specifier)).toContain(specifier);
      }
    }
  });

  it("name files and slugs that exist and are unique", () => {
    expect(new Set(ENTRY_POINTS.map((e) => e.slug)).size).toBe(
      ENTRY_POINTS.length,
    );
    for (const entry of ENTRY_POINTS) {
      expect(
        readdirSync(join(root, entry.file, "..")).includes(
          entry.file.split("/").pop()!,
        ),
      ).toBe(true);
    }
  });
});
