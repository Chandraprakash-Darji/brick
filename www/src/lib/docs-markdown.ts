import type { LLMsOptions } from "fumadocs-core/mdx-plugins/remark-llms";
import type {
  MdxJsxFlowElement,
  MdxJsxTextElement,
  MdxjsEsm,
} from "mdast-util-mdx";
import { z } from "zod";
import type { Root } from "mdast";
import { replaceSource } from "fumadocs-core/mdx-plugins/stringifier";
import { visit } from "unist-util-visit";
import { databaseFieldsSchema, databaseTableMarkdown } from "./database-schema";

function attribute(
  node: MdxJsxFlowElement | MdxJsxTextElement,
  name: string,
): unknown {
  const attr = node.attributes.find(
    (attr) => attr.type === "mdxJsxAttribute" && attr.name === name,
  );
  if (!attr || attr.type !== "mdxJsxAttribute") return undefined;
  if (typeof attr.value === "string") return attr.value;
  if (attr.value) return JSON.parse(attr.value.value);
  return undefined;
}

type Program = NonNullable<NonNullable<MdxjsEsm["data"]>["estree"]>;
type Expression = Extract<
  Program["body"][number],
  { type: "ExpressionStatement" }
>["expression"];

function staticValue(expression: Expression | null | undefined): unknown {
  if (!expression)
    throw new Error("DatabaseTable requires static field values.");
  switch (expression.type) {
    case "Literal":
      return expression.value;
    case "ArrayExpression":
      return expression.elements.map((element) => {
        if (element?.type === "SpreadElement")
          throw new Error("DatabaseTable does not support spreads.");
        return staticValue(element);
      });
    case "ObjectExpression":
      return Object.fromEntries(
        expression.properties.map((property) => {
          if (
            property.type !== "Property" ||
            property.computed ||
            property.kind !== "init" ||
            property.method ||
            property.value.type === "AssignmentPattern" ||
            property.value.type === "ArrayPattern" ||
            property.value.type === "ObjectPattern" ||
            property.value.type === "RestElement"
          ) {
            throw new Error("DatabaseTable requires static object fields.");
          }
          const key =
            property.key.type === "Identifier"
              ? property.key.name
              : staticValue(property.key);
          return [z.string().parse(key), staticValue(property.value)];
        }),
      );
    case "UnaryExpression":
      if (
        expression.operator === "-" &&
        expression.argument.type === "Literal" &&
        typeof expression.argument.value === "number"
      )
        return -expression.argument.value;
      break;
  }
  throw new Error("DatabaseTable requires static field values.");
}

function tableFields(
  node: MdxJsxFlowElement | MdxJsxTextElement,
  exports: Map<string, Expression>,
) {
  const attr = node.attributes.find(
    (attr) => attr.type === "mdxJsxAttribute" && attr.name === "fields",
  );
  if (
    !attr ||
    attr.type !== "mdxJsxAttribute" ||
    !attr.value ||
    typeof attr.value === "string"
  ) {
    throw new Error("DatabaseTable requires a fields array.");
  }
  const statement = attr.value.data?.estree?.body[0];
  let expression =
    statement?.type === "ExpressionStatement"
      ? statement.expression
      : undefined;
  if (expression?.type === "Identifier")
    expression = exports.get(expression.name);
  return databaseFieldsSchema.parse(staticValue(expression));
}

export const docsMarkdownOptions = { headingIds: false } satisfies LLMsOptions;

export function remarkDocsMarkdown() {
  return (tree: Root, file: Parameters<typeof replaceSource>[0]) => {
    if (file.path && !file.path.replaceAll("\\", "/").includes("content/docs/"))
      return;
    const exports = new Map<string, Expression>();
    visit(tree, "mdxjsEsm", (node) => {
      for (const statement of node.data?.estree?.body ?? []) {
        if (
          statement.type !== "ExportNamedDeclaration" ||
          statement.declaration?.type !== "VariableDeclaration"
        )
          continue;
        for (const declaration of statement.declaration.declarations) {
          if (declaration.id.type === "Identifier" && declaration.init)
            exports.set(declaration.id.name, declaration.init);
        }
      }
    });
    visit(tree, (node) => {
      if (
        node.type === "mdxFlowExpression" ||
        node.type === "mdxTextExpression"
      ) {
        throw new Error(
          "Docs markdown cannot render dynamic expressions. Use static markdown.",
        );
      }
      if (
        node.type !== "mdxJsxFlowElement" &&
        node.type !== "mdxJsxTextElement"
      )
        return;
      if (node.name === "DatabaseTable") {
        replaceSource(
          file,
          node,
          databaseTableMarkdown({
            name: z.string().parse(attribute(node, "name")),
            fields: tableFields(node, exports),
          }),
        );
        return;
      }
      replaceSource(file, node, (stringifier) => {
        const children = stringifier.inner(node).trim();
        if (node.name === "Tab") {
          const title = attribute(node, "title") ?? attribute(node, "value");
          return title
            ? `**${String(title)}**\n\n${children}\n`
            : `${children}\n`;
        }
        if (node.name === "Card") {
          const title = attribute(node, "title");
          const href = attribute(node, "href");
          return `${href ? `[${String(title ?? href)}](${String(href)})` : String(title ?? "")}\n\n${children}`;
        }
        if (node.name === "Callout") {
          const title = attribute(node, "title");
          return [title, children]
            .filter(Boolean)
            .join("\n\n")
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");
        }
        if (!children && node.name) {
          throw new Error(`Docs markdown needs a renderer for <${node.name}>.`);
        }
        return children;
      });
    });
  };
}
