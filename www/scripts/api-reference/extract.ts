// Reads what a package entry point exports, with the JSDoc on each export, into
// plain data the renderer turns into pages. Uses ts-morph, which carries its own
// TypeScript, so the docs site's TypeScript version does not matter here.
import {
  Node,
  type ClassDeclaration,
  type InterfaceDeclaration,
  type JSDoc,
  type ParameterDeclaration,
  type SourceFile,
  type VariableDeclaration,
} from "ts-morph";

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "variable";

export interface Parameter {
  name: string;
  type: string;
  optional: boolean;
  description: string;
  /** The default value as written, when the parameter has one. */
  default?: string;
}

export interface Signature {
  /** A declaration without its body, formatted for a code block. */
  text: string;
  parameters: Parameter[];
  returnType: string;
}

export interface Member {
  name: string;
  /** `property`, `method`, or `constructor`... */
  kind: string;
  /** For a property its type; for a method its signature. */
  type: string;
  optional: boolean;
  readonly: boolean;
  static: boolean;
  description: string;
  deprecated?: string;
  default?: string;
}

export interface ApiSymbol {
  name: string;
  kind: SymbolKind;
  /** Markdown, as written in JSDoc (links and headings not yet adjusted). */
  description: string;
  deprecated?: string;
  since?: string;
  returns?: string;
  examples: string[];
  throws: string[];
  see: string[];
  signatures: Signature[];
  members: Member[];
  /** The declaration of a type, enum, or variable, for a code block. */
  text?: string;
  /** What a class or interface extends and implements. */
  heritage?: string;
  /** The package a re-export comes from, when not this one. */
  external?: string;
  /** Repository-relative path and line of the declaration. */
  source?: { path: string; line: number };
}

interface Doc {
  description: string;
  params: Map<string, string>;
  returns?: string;
  deprecated?: string;
  since?: string;
  defaultValue?: string;
  examples: string[];
  throws: string[];
  see: string[];
  internal: boolean;
}

const MAX_TYPE = 220;
const MAX_LINES = 40;
const WIDTH = 80;

/** Types are one line in a table; keep them readable. */
export function tidyType(text: string, limit = MAX_TYPE): string {
  const flat = text
    .replace(/import\("[^"]*"\)\./g, "")
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .replace(/< /g, "<")
    .replace(/ >/g, ">")
    .replace(/, ([}\]>)])/g, " $1")
    .trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function emptyDoc(): Doc {
  return {
    description: "",
    params: new Map(),
    examples: [],
    throws: [],
    see: [],
    internal: false,
  };
}

/** `- text` after a name is how @param is usually written; the dash is not text. */
const undash = (text: string) => text.replace(/^\s*-\s+/, "").trim();

function readJsDoc(block: JSDoc, into: Doc): void {
  const description = block.getDescription().trim();
  if (description)
    into.description = into.description
      ? `${into.description}\n\n${description}`
      : description;
  for (const tag of block.getTags()) {
    const name = tag.getTagName();
    const text = (tag.getCommentText() ?? "").trim();
    if (Node.isJSDocParameterTag(tag)) {
      into.params.set(tag.getName(), undash(text));
    } else if (name === "returns" || name === "return") {
      into.returns = text;
    } else if (name === "deprecated") {
      into.deprecated = text || "Deprecated.";
    } else if (name === "since") {
      into.since = text;
    } else if (name === "default" || name === "defaultValue") {
      into.defaultValue = text;
    } else if (name === "example") {
      if (text) into.examples.push(text);
    } else if (name === "throws") {
      // `@throws {Error} when…`: TypeScript reads the braces as a type.
      const type = Node.isJSDocThrowsTag(tag)
        ? tag.getTypeExpression()?.getTypeNode().getText()
        : undefined;
      const entry = [type ? `\`${type}\`` : "", text].filter(Boolean).join(" ");
      if (entry) into.throws.push(entry);
    } else if (name === "see") {
      if (text) into.see.push(text);
    } else if (name === "remarks") {
      if (text)
        into.description = into.description
          ? `${into.description}\n\n${text}`
          : text;
    } else if (name === "internal") {
      into.internal = true;
    }
  }
}

function readDoc(...nodes: (Node | undefined)[]): Doc {
  const doc = emptyDoc();
  for (const node of nodes) {
    if (!node || !Node.isJSDocable(node)) continue;
    const blocks = node.getJsDocs();
    // The block next to the declaration is the one that describes it.
    const block = blocks[blocks.length - 1];
    if (block) readJsDoc(block, doc);
    if (doc.description || doc.params.size > 0) break;
  }
  return doc;
}

/** A type as written, or as the checker reads it when nothing was written. */
function typeOf(text: string | undefined, fallback: () => string): string {
  return tidyType(text ?? fallback());
}

/** A signature's pieces as one declaration, split over lines if it is long. */
function formatSignature(
  head: string,
  typeParameters: string[],
  parameters: string[],
  returnType: string | undefined,
  keyword = "",
): string {
  const params = parameters.map((p) => tidyType(p, 160));
  const generics = typeParameters.map((p) => tidyType(p, 160));
  const tail = returnType ? `: ${tidyType(returnType, 160)}` : "";
  const flatGenerics = generics.length ? `<${generics.join(", ")}>` : "";
  const flat = `${keyword}${head}${flatGenerics}(${params.join(", ")})${tail}`;
  if (flat.length <= WIDTH) return flat;
  // Too long for a line: type parameters and parameters each on their own.
  const open =
    generics.length > 1 || flatGenerics.length > WIDTH - head.length
      ? `<\n${generics.map((g) => `  ${g},`).join("\n")}\n>`
      : flatGenerics;
  if (params.length === 0) return `${keyword}${head}${open}()${tail}`;
  return `${keyword}${head}${open}(\n${params.map((p) => `  ${p},`).join("\n")}\n)${tail}`;
}

function parametersOf(
  fn: {
    getParameters(): ParameterDeclaration[];
  },
  doc: Doc,
): { rows: Parameter[]; texts: string[] } {
  const rows: Parameter[] = [];
  const texts: string[] = [];
  for (const parameter of fn.getParameters()) {
    const name = parameter.getName();
    const type = typeOf(parameter.getTypeNode()?.getText(), () =>
      parameter.getType().getText(parameter),
    );
    const initializer = parameter.getInitializer()?.getText();
    rows.push({
      name,
      type,
      optional: parameter.isOptional() || initializer !== undefined,
      description: doc.params.get(name) ?? "",
      ...(initializer !== undefined
        ? { default: tidyType(initializer, 60) }
        : {}),
    });
    texts.push(tidyType(parameter.getText(), 200));
    // `@param options.port - ...` documents a field of a destructured option.
    for (const [key, description] of doc.params) {
      if (key.startsWith(`${name}.`))
        rows.push({
          name: key,
          type: "",
          optional: false,
          description,
        });
    }
  }
  return { rows, texts };
}

function functionSignature(
  name: string,
  declaration: {
    getTypeParameters(): { getText(): string }[];
    getParameters(): ParameterDeclaration[];
    getReturnTypeNode(): Node | undefined;
    getReturnType(): { getText(enclosing?: Node): string };
    isAsync(): boolean;
  },
  doc: Doc,
  enclosing: Node,
): Signature {
  const { rows, texts } = parametersOf(declaration, doc);
  const returnType = tidyType(
    declaration.getReturnTypeNode()?.getText() ??
      declaration.getReturnType().getText(enclosing),
  );
  return {
    text: formatSignature(
      `function ${name}`,
      declaration.getTypeParameters().map((p) => p.getText()),
      texts,
      returnType,
    ),
    parameters: rows,
    returnType,
  };
}

function isFunctionLike(declaration: VariableDeclaration) {
  const initializer = declaration.getInitializer();
  return (
    initializer !== undefined &&
    (Node.isArrowFunction(initializer) ||
      Node.isFunctionExpression(initializer))
  );
}

const capped = (text: string) => {
  const lines = text.split("\n");
  return lines.length > MAX_LINES
    ? `${lines.slice(0, MAX_LINES).join("\n")}\n  // …`
    : text;
};

function membersOfInterface(declaration: InterfaceDeclaration): Member[] {
  return declaration.getMembers().flatMap((member): Member[] => {
    const doc = readDoc(member);
    if (doc.internal) return [];
    const common = {
      optional: false,
      readonly: false,
      static: false,
      description: doc.description,
      ...(doc.deprecated ? { deprecated: doc.deprecated } : {}),
      ...(doc.defaultValue ? { default: doc.defaultValue } : {}),
    };
    if (Node.isPropertySignature(member)) {
      return [
        {
          ...common,
          name: member.getName(),
          kind: "property",
          type: typeOf(member.getTypeNode()?.getText(), () =>
            member.getType().getText(member),
          ),
          optional: member.hasQuestionToken(),
          readonly: member.isReadonly(),
        },
      ];
    }
    if (Node.isMethodSignature(member)) {
      const params = member
        .getParameters()
        .map((p) => tidyType(p.getText(), 160));
      return [
        {
          ...common,
          name: member.getName(),
          kind: "method",
          type: formatSignature(
            member.getName(),
            member.getTypeParameters().map((p) => p.getText()),
            params,
            member.getReturnTypeNode()?.getText() ?? "void",
          ),
          optional: member.hasQuestionToken(),
        },
      ];
    }
    if (Node.isCallSignatureDeclaration(member)) {
      return [
        {
          ...common,
          name: "(call)",
          kind: "call",
          type: tidyType(member.getText().replace(/;$/, ""), 300),
        },
      ];
    }
    return [
      {
        ...common,
        name: "[index]",
        kind: "index",
        type: tidyType(member.getText().replace(/;$/, ""), 300),
      },
    ];
  });
}

function membersOfClass(declaration: ClassDeclaration): Member[] {
  const visible = (node: Node) =>
    Node.isScoped(node) ? node.getScope() === "public" : true;
  const out: Member[] = [];
  for (const member of declaration.getMembers()) {
    if (!visible(member)) continue;
    const doc = readDoc(member);
    if (doc.internal) continue;
    const base = {
      optional: false,
      readonly: false,
      static: false,
      description: doc.description,
      ...(doc.deprecated ? { deprecated: doc.deprecated } : {}),
    };
    if (Node.isConstructorDeclaration(member)) {
      out.push({
        ...base,
        name: "constructor",
        kind: "constructor",
        type: formatSignature(
          "new ",
          [],
          member.getParameters().map((p) => tidyType(p.getText(), 160)),
          undefined,
        ),
      });
    } else if (Node.isMethodDeclaration(member)) {
      out.push({
        ...base,
        name: member.getName(),
        kind: "method",
        static: member.isStatic(),
        type: formatSignature(
          member.getName(),
          member.getTypeParameters().map((p) => p.getText()),
          member.getParameters().map((p) => tidyType(p.getText(), 160)),
          member.getReturnTypeNode()?.getText() ??
            member.getReturnType().getText(member),
        ),
      });
    } else if (Node.isPropertyDeclaration(member)) {
      if (member.getName().startsWith("#")) continue;
      out.push({
        ...base,
        name: member.getName(),
        kind: "property",
        static: member.isStatic(),
        readonly: member.isReadonly(),
        optional: member.hasQuestionToken(),
        type: typeOf(member.getTypeNode()?.getText(), () =>
          member.getType().getText(member),
        ),
      });
    } else if (
      Node.isGetAccessorDeclaration(member) ||
      Node.isSetAccessorDeclaration(member)
    ) {
      if (out.some((m) => m.name === member.getName() && m.kind === "accessor"))
        continue;
      out.push({
        ...base,
        name: member.getName(),
        kind: "accessor",
        static: member.isStatic(),
        type: typeOf(member.getReturnTypeNode()?.getText(), () =>
          member.getType().getText(member),
        ),
      });
    }
  }
  return out;
}

function externalPackage(path: string): string | undefined {
  const match =
    /\/node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)\//.exec(
      path,
    );
  return match?.[1];
}

/**
 * Where a declaration lives when it is not in the package being documented: an
 * installed dependency, or another package of this repository (the published
 * ones are all `@brickkit/<folder>`), which resolves to its built declarations.
 */
function foreignPackage(file: string, ownRoot: string): string | undefined {
  const installed = externalPackage(file);
  if (installed) return installed;
  const workspace = /\/packages\/([^/]+)\//.exec(file);
  return workspace && !file.startsWith(ownRoot)
    ? `@brickkit/${workspace[1]}`
    : undefined;
}

function describe(
  name: string,
  declaration: Node,
  repoRoot: string,
  ownRoot: string,
): ApiSymbol | undefined {
  const file = declaration.getSourceFile().getFilePath();
  const external = foreignPackage(file, ownRoot);
  const base = (kind: SymbolKind, doc: Doc): ApiSymbol => ({
    name,
    kind,
    description: doc.description,
    ...(doc.deprecated ? { deprecated: doc.deprecated } : {}),
    ...(doc.since ? { since: doc.since } : {}),
    ...(doc.returns ? { returns: doc.returns } : {}),
    examples: doc.examples,
    throws: doc.throws,
    see: doc.see,
    signatures: [],
    members: [],
    ...(external ? { external } : {}),
    ...(!external
      ? {
          source: {
            path: file.startsWith(repoRoot)
              ? file.slice(repoRoot.length).replace(/^\//, "")
              : file,
            line: declaration.getStartLineNumber(),
          },
        }
      : {}),
  });

  if (Node.isFunctionDeclaration(declaration)) {
    const overloads = declaration.getOverloads();
    const doc = readDoc(...overloads, declaration);
    if (doc.internal) return undefined;
    const symbol = base("function", doc);
    const callables = overloads.length > 0 ? overloads : [declaration];
    symbol.signatures = callables.map((fn) =>
      functionSignature(name, fn, doc, fn),
    );
    return symbol;
  }
  if (Node.isVariableDeclaration(declaration)) {
    const statement = declaration.getVariableStatement();
    const doc = readDoc(statement);
    if (doc.internal) return undefined;
    if (isFunctionLike(declaration)) {
      const initializer = declaration.getInitializerOrThrow();
      if (
        Node.isArrowFunction(initializer) ||
        Node.isFunctionExpression(initializer)
      ) {
        const symbol = base("function", doc);
        symbol.signatures = [
          functionSignature(name, initializer, doc, declaration),
        ];
        return symbol;
      }
    }
    const symbol = base("variable", doc);
    const type = typeOf(declaration.getTypeNode()?.getText(), () =>
      declaration.getType().getText(declaration),
    );
    symbol.text = `const ${name}: ${type}`;
    return symbol;
  }
  if (Node.isClassDeclaration(declaration)) {
    const doc = readDoc(declaration);
    if (doc.internal) return undefined;
    const symbol = base("class", doc);
    const generics = declaration.getTypeParameters().map((p) => p.getText());
    const extendsText = declaration.getExtends()?.getText();
    const implementsText = declaration.getImplements().map((i) => i.getText());
    symbol.heritage = tidyType(
      [
        extendsText ? `extends ${extendsText}` : "",
        implementsText.length ? `implements ${implementsText.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    symbol.text = `${declaration.isAbstract() ? "abstract " : ""}class ${name}${
      generics.length
        ? `<${generics.map((g) => tidyType(g, 120)).join(", ")}>`
        : ""
    }${symbol.heritage ? ` ${symbol.heritage}` : ""}`;
    symbol.members = membersOfClass(declaration);
    return symbol;
  }
  if (Node.isInterfaceDeclaration(declaration)) {
    const doc = readDoc(declaration);
    if (doc.internal) return undefined;
    const symbol = base("interface", doc);
    const generics = declaration.getTypeParameters().map((p) => p.getText());
    const extended = declaration.getExtends().map((e) => e.getText());
    symbol.heritage = extended.length
      ? `extends ${tidyType(extended.join(", "))}`
      : "";
    symbol.text = `interface ${name}${
      generics.length
        ? `<${generics.map((g) => tidyType(g, 120)).join(", ")}>`
        : ""
    }${symbol.heritage ? ` ${symbol.heritage}` : ""}`;
    symbol.members = membersOfInterface(declaration);
    return symbol;
  }
  if (Node.isTypeAliasDeclaration(declaration)) {
    const doc = readDoc(declaration);
    if (doc.internal) return undefined;
    const symbol = base("type", doc);
    symbol.text = capped(
      declaration
        .getText()
        .replace(/^export\s+/, "")
        .trim(),
    );
    const node = declaration.getTypeNode();
    if (node && Node.isTypeLiteral(node)) {
      symbol.members = node.getMembers().flatMap((member): Member[] => {
        if (!Node.isPropertySignature(member)) return [];
        const memberDoc = readDoc(member);
        return [
          {
            name: member.getName(),
            kind: "property",
            type: typeOf(member.getTypeNode()?.getText(), () =>
              member.getType().getText(member),
            ),
            optional: member.hasQuestionToken(),
            readonly: member.isReadonly(),
            static: false,
            description: memberDoc.description,
            ...(memberDoc.deprecated
              ? { deprecated: memberDoc.deprecated }
              : {}),
          },
        ];
      });
    }
    return symbol;
  }
  if (Node.isEnumDeclaration(declaration)) {
    const doc = readDoc(declaration);
    if (doc.internal) return undefined;
    const symbol = base("enum", doc);
    symbol.text = `enum ${name}`;
    symbol.members = declaration.getMembers().map((member) => ({
      name: member.getName(),
      kind: "property",
      type: String(member.getValue() ?? ""),
      optional: false,
      readonly: false,
      static: false,
      description: readDoc(member).description,
    }));
    return symbol;
  }
  return undefined;
}

/**
 * Everything `entry` exports, including what it re-exports from other files and
 * packages, with the JSDoc on each. Exports tagged `@internal` are left out.
 * `repoRoot` makes the source paths relative.
 */
export function extractExports(
  entry: SourceFile,
  repoRoot: string,
  onProblem: (message: string) => void = () => {},
): ApiSymbol[] {
  const symbols: ApiSymbol[] = [];
  // The folder of the package the entry belongs to, such as `/repo/packages/cli/`.
  const entryPath = entry.getFilePath();
  const ownRoot =
    /^(.*\/packages\/[^/]+\/)/.exec(entryPath)?.[1] ??
    entryPath.slice(0, entryPath.lastIndexOf("/") + 1);
  for (const [name, declarations] of entry.getExportedDeclarations()) {
    // A name can have several declarations (an interface and a const); take the
    // first that says something, preferring one with a description.
    const candidates = declarations
      .map((declaration) => {
        try {
          return describe(name, declaration, repoRoot, ownRoot);
        } catch (error) {
          onProblem(
            `${name}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return undefined;
        }
      })
      .filter((symbol): symbol is ApiSymbol => symbol !== undefined);
    const chosen =
      candidates.find((symbol) => symbol.description) ?? candidates[0];
    if (chosen) symbols.push(chosen);
  }
  return symbols;
}
