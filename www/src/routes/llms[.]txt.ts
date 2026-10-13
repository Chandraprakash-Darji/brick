import {
  getDocsSections,
  markdownResponse,
  slugsToMarkdownPath,
} from "@/lib/source";
import { createFileRoute } from "@tanstack/react-router";
import { site } from "@/lib/site";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET() {
        const origin = site.url;
        const sections = getDocsSections().map(
          (section) =>
            `## ${section.title}\n\n${section.pages
              .map(
                (page) =>
                  `- [${page.data.title}](${origin}${slugsToMarkdownPath(page.slugs).url}): ${page.data.description ?? page.data.title}`,
              )
              .join("\n")}`,
        );
        return markdownResponse(
          [
            "# Brick",
            "> Brick is a TypeScript backend framework for Bun. Define services, actions, resources, and MCP tools with typed schemas.",
            "Follow the page links for focused context, or read [all documentation](" +
              origin +
              "/llms-full.txt).",
            ...sections,
          ].join("\n\n"),
        );
      },
    },
  },
});
