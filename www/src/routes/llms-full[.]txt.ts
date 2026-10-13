import { createFileRoute } from "@tanstack/react-router";
import { getDocsSections, getLLMText, markdownResponse } from "@/lib/source";

export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: async () => {
        const scan = getDocsSections()
          .flatMap((section) => section.pages)
          .map(getLLMText);
        const scanned = await Promise.all(scan);
        return markdownResponse(scanned.join("\n\n---\n\n"));
      },
    },
  },
});
