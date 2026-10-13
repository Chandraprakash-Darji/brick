import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  getLLMText,
  markdownPathToSlugs,
  markdownResponse,
  source,
} from "@/lib/source";

export const Route = createFileRoute("/docs/{$}.md")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slugs = markdownPathToSlugs(params._splat?.split("/") ?? []);
        const page = source.getPage(slugs);
        if (!page) throw notFound();

        return markdownResponse(await getLLMText(page));
      },
    },
  },
});
