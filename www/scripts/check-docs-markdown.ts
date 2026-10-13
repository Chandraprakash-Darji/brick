import { remark } from "remark";
import remarkMdx from "remark-mdx";
import remarkGfm from "remark-gfm";
import { remarkLLMs } from "fumadocs-core/mdx-plugins/remark-llms";
import { visit } from "unist-util-visit";
import { z } from "zod";
import {
  docsMarkdownOptions,
  remarkDocsMarkdown,
} from "../src/lib/docs-markdown";

export function renderDocsMarkdown(content: string) {
  const processor = remark()
    .use(remarkMdx)
    .use(remarkGfm)
    .use(remarkDocsMarkdown)
    .use(remarkLLMs, {
      ...docsMarkdownOptions,
      _data: true,
    });
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const file = processor.processSync(body);
  const markdown = z.string().parse(file.data.markdown);
  visit(processor.parse(markdown), (node) => {
    if (node.type.startsWith("mdx")) {
      throw new Error(`Unrendered ${node.type} in documentation markdown`);
    }
  });
  return markdown;
}

if (import.meta.main) {
  const root = new URL("../content/docs/", import.meta.url);
  let count = 0;
  for await (const path of new Bun.Glob("**/*.mdx").scan(root.pathname)) {
    try {
      renderDocsMarkdown(await Bun.file(new URL(path, root)).text());
      count++;
    } catch (error) {
      throw new Error(`Cannot render docs page ${path}`, { cause: error });
    }
  }
  console.log(`Validated markdown for ${count} docs pages.`);
}
