import type { LLMsOptions } from "fumadocs-core/mdx-plugins/remark-llms";
import type { MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx";
import { z } from "zod";
import type { Root } from "mdast";
import { replaceSource } from "fumadocs-core/mdx-plugins/stringifier";
import { visit } from "unist-util-visit";

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

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const docsMarkdownOptions = { headingIds: false } satisfies LLMsOptions;

export function remarkDocsMarkdown() {
  return (tree: Root, file: Parameters<typeof replaceSource>[0]) => {
    if (file.path && !file.path.replaceAll("\\", "/").includes("content/docs/"))
      return;
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
        const columns = z
          .array(z.string())
          .nonempty()
          .parse(attribute(node, "columns"));
        const rows = z.array(z.array(cell)).parse(attribute(node, "rows"));
        if (rows.some((row) => row.length !== columns.length)) {
          throw new Error("DatabaseTable rows must match the columns.");
        }
        const line = (values: unknown[]) =>
          `| ${values
            .map((value) =>
              String(value ?? "")
                .replaceAll("|", "\\|")
                .replace(/\r?\n/g, " "),
            )
            .join(" | ")} |`;
        replaceSource(
          file,
          node,
          [
            line(columns),
            line(columns.map(() => "---")),
            ...rows.map(line),
          ].join("\n"),
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
