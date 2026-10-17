// Turns the extracted exports of an entry point into a docs page: plain
// Markdown (headings, tables, code blocks), so it renders the same on the site,
// in the plain-text version for LLMs, and in any Markdown viewer.
import type { ApiSymbol, Member, Parameter, SymbolKind } from "./extract";

export interface EntryPage {
  /** File name without extension, and the page's address. */
  slug: string;
  /** What it is imported as, such as `@brickkit/core/client`. */
  specifier: string;
  description: string;
  symbols: ApiSymbol[];
}

export interface Repository {
  url: string;
  branch: string;
}

const SECTIONS: {
  kind: SymbolKind;
  title: string;
  one: string;
  many: string;
}[] = [
  { kind: "function", title: "Functions", one: "function", many: "functions" },
  { kind: "class", title: "Classes", one: "class", many: "classes" },
  {
    kind: "interface",
    title: "Interfaces",
    one: "interface",
    many: "interfaces",
  },
  { kind: "type", title: "Types", one: "type", many: "types" },
  { kind: "enum", title: "Enums", one: "enum", many: "enums" },
  {
    kind: "variable",
    title: "Variables",
    one: "variable",
    many: "variables",
  },
];

/** The id Fumadocs gives a heading, for links to a symbol on the same page. */
export function anchorOf(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\- ]/gu, "")
    .replace(/ /g, "-");
}

/** Text with MDX's special characters made plain, outside code. */
function escapeProse(text: string): string {
  return text
    .replace(/&(?![a-z]+;|#\d+;)/gi, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

/** Split a paragraph into code spans (kept as they are) and other text. */
function mapOutsideCode(text: string, change: (prose: string) => string) {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(/(`+)[\s\S]*?\1/g)) {
    out += change(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + change(text.slice(last));
}

/**
 * `{@link Name}` and its variants, as Markdown links where the target is known:
 * `hrefs` maps a name to where its section is.
 */
function resolveLinks(text: string, anchors: ReadonlyMap<string, string>) {
  return text.replace(
    /\{@(?:link|linkcode|linkplain)\s+([^\s|}]+)\s*(?:\|\s*|\s)?([^}]*)\}/g,
    (_, target: string, label: string) => {
      const shown = label.trim();
      if (/^https?:\/\//.test(target)) return `[${shown || target}](${target})`;
      const href = anchors.get(target.replace(/\(\)$/, ""));
      const code = `\`${shown || target}\``;
      return href ? `[${code}](${href})` : code;
    },
  );
}

/**
 * JSDoc Markdown as MDX: links resolved, headings made bold (a symbol's own
 * headings would crowd the page's table of contents), and the characters MDX
 * reads as code or components made plain, everywhere but in code.
 */
export function proseToMdx(
  markdown: string,
  anchors: ReadonlyMap<string, string> = new Map(),
): string {
  const lines = resolveLinks(markdown, anchors).split("\n");
  const out: string[] = [];
  let fence: string | undefined;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    out.push(mapOutsideCode(paragraph.join("\n"), escapeProse));
    paragraph = [];
  };
  for (const line of lines) {
    const opening = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      out.push(line);
      // A fence ends at a line of only its own character, at least as long.
      if (
        opening &&
        opening[1]![0] === fence[0] &&
        opening[1]!.length >= fence.length &&
        line.trim() === opening[1]
      )
        fence = undefined;
      continue;
    }
    if (opening) {
      flush();
      fence = opening[1];
      out.push(line);
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      out.push(`**${mapOutsideCode(heading[1]!, escapeProse)}**`);
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return out.join("\n").trim();
}

/** One line to say what something is: the first sentence of its description. */
export function summaryOf(description: string): string {
  const first = description.trim().split(/\n\s*\n/)[0] ?? "";
  const plain = first
    .replace(
      /\{@(?:link|linkcode|linkplain)\s+([^\s|}]+)\s*(?:\|\s*|\s)?([^}]*)\}/g,
      (_, t: string, l: string) => l.trim() || t,
    )
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = /^(.*?[.!?])(\s|$)/.exec(plain)?.[1] ?? plain;
  return sentence.length > 160 ? `${sentence.slice(0, 159)}…` : sentence;
}

const cell = (text: string) =>
  text
    .replace(/\s*\n\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();

/** Code for a table cell. */
function code(text: string): string {
  if (!text) return "";
  const fence = text.includes("`") ? "``" : "`";
  const padded =
    text.startsWith("`") || text.endsWith("`") ? ` ${text} ` : text;
  return `${fence}${cell(padded)}${fence}`;
}

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

/** Where an export's section is: which page, and the id of its heading. */
export interface SymbolLocation {
  slug: string;
  anchor: string;
  kind: SymbolKind;
}
export type SymbolIndex = ReadonlyMap<string, SymbolLocation[]>;

/** Every export the packages define, by name, for links between pages. */
export function buildSymbolIndex(entries: EntryPage[]): SymbolIndex {
  const index = new Map<string, SymbolLocation[]>();
  for (const entry of entries)
    for (const symbol of entry.symbols) {
      // A re-export has no section; its home page does.
      if (symbol.external) continue;
      index.set(symbol.name, [
        ...(index.get(symbol.name) ?? []),
        { slug: entry.slug, anchor: anchorOf(symbol.name), kind: symbol.kind },
      ]);
    }
  return index;
}

interface Links {
  /** Every export, for `{@link Name}`. */
  hrefs: ReadonlyMap<string, string>;
  /** Types, classes, and enums, for the types in signatures and tables. */
  types: ReadonlyMap<string, string>;
  /** The export being described, which does not link to itself. */
  self?: string;
}

/** Where each name is, from the page `current`: on it, or on the page that has it. */
function linksFor(index: SymbolIndex, current: string): Links {
  const hrefs = new Map<string, string>();
  const types = new Map<string, string>();
  for (const [name, locations] of index) {
    const home = locations.find((l) => l.slug === current) ?? locations[0]!;
    const href =
      home.slug === current
        ? `#${home.anchor}`
        : `/docs/api-reference/${home.slug}#${home.anchor}`;
    hrefs.set(name, href);
    if (
      locations.some((l) =>
        ["interface", "type", "class", "enum"].includes(l.kind),
      )
    )
      types.set(name, href);
  }
  return { hrefs, types };
}

/**
 * A type as inline code, with the names of types this reference documents
 * made links. A link cannot sit inside a code span, so the type is cut into
 * code pieces and links between them.
 */
export function linkTypes(type: string, links: Links): string {
  if (!type) return "";
  const pieces: { text: string; href?: string }[] = [];
  let last = 0;
  const token =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;
  for (const match of type.matchAll(token)) {
    const name = match[2];
    if (!name || name.includes(".") || name === links.self) continue;
    const href = links.types.get(name);
    if (!href) continue;
    const before = type.slice(0, match.index).trimEnd();
    const after = type.slice(match.index + name.length);
    // A property or parameter name, such as `contract` in `{ contract: T }`.
    if (/[{;,(]$/.test(before) && /^\s*\??:/.test(after)) continue;
    if (before.endsWith(".")) continue;
    if (match.index > last)
      pieces.push({ text: type.slice(last, match.index) });
    pieces.push({ text: name, href });
    last = match.index + name.length;
  }
  if (pieces.length === 0) return code(type);
  if (last < type.length) pieces.push({ text: type.slice(last) });
  return pieces
    .map(({ text, href }) => {
      if (href) return `[\`${text}\`](${href})`;
      const [, lead = "", body = "", trail = ""] =
        /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];
      // A bare `|`, `&`, or `,` between two links reads better as text.
      const shown = /^[|&,]+$/.test(body)
        ? body.replace(/\|/g, "\\|").replace(/&/g, "&amp;")
        : body
          ? code(body)
          : "";
      return `${lead}${shown}${trail}`;
    })
    .join("");
}

function parameterRows(parameters: Parameter[], links: Links): string[][] {
  return parameters.map((parameter) => [
    code(
      `${parameter.name}${parameter.optional && !parameter.name.includes(".") ? "?" : ""}`,
    ),
    [
      linkTypes(parameter.type, links),
      parameter.default ? `default ${code(parameter.default)}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    cell(proseToMdx(parameter.description, links.hrefs)),
  ]);
}

function memberRows(members: Member[], links: Links): string[][] {
  return members.map((member) => {
    const name = [
      member.static ? "static " : "",
      member.readonly ? "readonly " : "",
      member.name,
      member.optional ? "?" : "",
    ].join("");
    const notes = [
      member.deprecated ? `**Deprecated.** ${member.deprecated}` : "",
      member.description,
      member.default ? `Default: \`${member.default}\`` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return [
      code(name),
      linkTypes(member.type, links),
      cell(proseToMdx(notes, links.hrefs)),
    ];
  });
}

function renderSymbol(
  symbol: ApiSymbol,
  allLinks: Links,
  repository: Repository,
): string {
  const links: Links = { ...allLinks, self: symbol.name };
  const anchors = links.hrefs;
  const out: string[] = [`### ${symbol.name}`, ""];
  const fenced = (text: string) => ["```ts", text, "```", ""];

  if (symbol.kind === "function") {
    out.push(...fenced(symbol.signatures.map((s) => s.text).join("\n\n")));
  } else if (symbol.text) {
    out.push(...fenced(symbol.text));
  }
  if (symbol.external)
    out.push(`*Re-exported from \`${symbol.external}\`.*`, "");
  if (symbol.deprecated)
    out.push(`> **Deprecated.** ${proseToMdx(symbol.deprecated, anchors)}`, "");
  if (symbol.description) out.push(proseToMdx(symbol.description, anchors), "");

  // The overload with the most parameters has the fullest table.
  const widest = [...symbol.signatures].sort(
    (a, b) => b.parameters.length - a.parameters.length,
  )[0];
  if (widest && widest.parameters.length > 0)
    out.push(
      "**Parameters**",
      "",
      table(
        ["Name", "Type", "Description"],
        parameterRows(widest.parameters, links),
      ),
      "",
    );
  if (symbol.kind === "function" && widest) {
    const returns = symbol.returns
      ? ` ${proseToMdx(symbol.returns, anchors)}`
      : "";
    if (widest.returnType && widest.returnType !== "void")
      out.push(
        `**Returns** ${linkTypes(widest.returnType, links)}${returns ? ` —${returns}` : ""}`,
        "",
      );
    else if (returns) out.push(`**Returns**${returns}`, "");
  }
  if (symbol.throws.length > 0)
    out.push(
      "**Throws**",
      "",
      ...symbol.throws.map((text) => `- ${proseToMdx(text, anchors)}`),
      "",
    );

  if (symbol.members.length > 0) {
    const constructors = symbol.members.filter((m) => m.kind === "constructor");
    const methods = symbol.members.filter((m) => m.kind === "method");
    const rest = symbol.members.filter(
      (m) => m.kind !== "constructor" && m.kind !== "method",
    );
    const groups: [string, Member[]][] =
      symbol.kind === "class"
        ? [
            ["Constructor", constructors],
            ["Properties", rest],
            ["Methods", methods],
          ]
        : [
            [symbol.kind === "enum" ? "Members" : "Properties", rest],
            ["Methods", methods],
          ];
    for (const [title, members] of groups) {
      if (members.length === 0) continue;
      out.push(
        `**${title}**`,
        "",
        table(
          [
            title === "Members" ? "Name" : "Name",
            title === "Members" ? "Value" : "Type",
            "Description",
          ],
          memberRows(members, links),
        ),
        "",
      );
    }
  }

  for (const example of symbol.examples) {
    const body = /^\s*```/.test(example)
      ? example.trim()
      : ["```ts", example.trim(), "```"].join("\n");
    out.push("**Example**", "", body, "");
  }
  if (symbol.see.length > 0)
    out.push(
      "**See also**",
      "",
      ...symbol.see.map((text) => `- ${proseToMdx(text, anchors)}`),
      "",
    );
  if (symbol.since) out.push(`*Since ${symbol.since}.*`, "");
  if (symbol.source) {
    const { path, line } = symbol.source;
    out.push(
      `*Source: [${path}:${line}](${repository.url}/blob/${repository.branch}/${path}#L${line})*`,
      "",
    );
  }
  return out.join("\n");
}

const byName = (a: ApiSymbol, b: ApiSymbol) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
  a.name.localeCompare(b.name);

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** The page for one entry point. */
export function renderEntry(
  entry: EntryPage,
  repository: Repository,
  index: SymbolIndex = buildSymbolIndex([entry]),
): string {
  // What the package defines gets a section each; what it only passes along
  // from another package is a table, since that package documents it.
  const own = entry.symbols.filter((symbol) => !symbol.external);
  const links = linksFor(index, entry.slug);
  const out: string[] = [
    "---",
    "# Generated by scripts/generate-api-reference.ts from the JSDoc in the source. Edit that, not this.",
    `title: ${JSON.stringify(entry.specifier)}`,
    `description: ${JSON.stringify(entry.description)}`,
    "---",
    "",
  ];
  const counts = SECTIONS.map((section) => ({
    ...section,
    symbols: own.filter((s) => s.kind === section.kind).sort(byName),
  })).filter((section) => section.symbols.length > 0);
  const reexported = new Map<string, ApiSymbol[]>();
  for (const symbol of entry.symbols)
    if (symbol.external)
      reexported.set(symbol.external, [
        ...(reexported.get(symbol.external) ?? []),
        symbol,
      ]);
  // Values to show an import of; types need `import type` and come last.
  const isValue = (s: ApiSymbol) => s.kind !== "interface" && s.kind !== "type";
  const preferred = own.filter(isValue).sort(byName);
  const names = (preferred.length > 0 ? preferred : [...own].sort(byName))
    .slice(0, 3)
    .map((s) => s.name);
  const importKeyword = preferred.length > 0 ? "import" : "import type";
  const alsoFrom = [...reexported]
    .map(([name, symbols]) => `${symbols.length} from \`${name}\``)
    .join(" and ");
  // The page already shows the description under its title.
  out.push(
    `\`${entry.specifier}\` exports ${plural(own.length, "name")}: ${counts
      .map((c) => plural(c.symbols.length, c.one, c.many))
      .join(", ")}.${alsoFrom ? ` It also re-exports ${alsoFrom}.` : ""}`,
    "",
    "```ts",
    ...(names.length > 0
      ? [`${importKeyword} { ${names.join(", ")} } from "${entry.specifier}";`]
      : ["// Nothing is defined here: see the re-exports below."]),
    "```",
    "",
  );
  for (const section of counts) {
    out.push(`## ${section.title}`, "");
    if (section.kind === "function")
      out.push(
        table(
          ["Function", "Description"],
          section.symbols.map((symbol) => [
            `[\`${symbol.name}\`](#${anchorOf(symbol.name)})`,
            cell(escapeProse(summaryOf(symbol.description))),
          ]),
        ),
        "",
      );
    for (const symbol of section.symbols)
      out.push(renderSymbol(symbol, links, repository));
  }
  for (const [name, symbols] of reexported) {
    out.push(
      `## Re-exported from ${name}`,
      "",
      `These come from \`${name}\`, which documents them. They are exported here so one import covers them.`,
      "",
      table(
        ["Name", "Kind", "Description"],
        [...symbols]
          .sort(byName)
          .map((symbol) => [
            code(symbol.name),
            symbol.kind,
            cell(escapeProse(summaryOf(symbol.description))),
          ]),
      ),
      "",
    );
  }
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

/** The page that lists the entry points. */
export function renderIndex(entries: EntryPage[]): string {
  const rows = entries.map((entry) => [
    `[\`${entry.specifier}\`](/docs/api-reference/${entry.slug})`,
    cell(escapeProse(entry.description)),
    String(entry.symbols.length),
  ]);
  return `---
# Generated by scripts/generate-api-reference.ts from the JSDoc in the source. Edit that, not this.
title: "API Reference"
description: "Every function, class, and type the Brick packages export, generated from the JSDoc in their source."
---

Every function, class, interface, and type that the Brick packages export, with its signature, parameters, return value, and examples, so you do not have to read the source to find out what one does. The pages are generated from the JSDoc in the source, so they are always as current as the code.

${table(["Import", "What it is", "Exports"], rows)}

Each page lists its functions first, with a line about each, then classes, interfaces, and types. Search finds any name. Names are re-exported from where they are defined, so a type may appear on more than one page.

## Improve a description

The text on these pages is the JSDoc above each export in \`packages/*/src\`. To fix or add one, edit the comment there: the first paragraph is the summary, \`@param name - text\` describes a parameter, \`@returns\` the result, \`@example\` adds a code sample, \`@throws\` and \`@deprecated\` are shown as written, and \`@internal\` leaves an export out of this reference.
`;
}

/** The sidebar for the section: one group per package. */
export function renderMeta(entries: EntryPage[]): string {
  const pages: string[] = ["index"];
  let group: string | undefined;
  for (const entry of entries) {
    const name = entry.specifier.split("/").slice(0, 2).join("/");
    if (name !== group) {
      group = name;
      pages.push(`---${name}---`);
    }
    pages.push(entry.slug);
  }
  return `${JSON.stringify(
    {
      title: "API Reference",
      description:
        "Every exported function, class, and type, from the source's JSDoc",
      icon: "Braces",
      root: true,
      pages,
    },
    null,
    2,
  )}\n`;
}
