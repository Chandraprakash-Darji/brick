import {
  createMiddleware,
  createCsrfMiddleware,
  createStart,
} from "@tanstack/react-start";
import { isMarkdownPreferred } from "fumadocs-core/negotiation";
import { docsRoute } from "@/lib/shared";
import { getLLMText, markdownResponse, source } from "./lib/source";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const llmMiddleware = createMiddleware().server(async ({ next, request }) => {
  const url = new URL(request.url);

  if (
    (url.pathname === docsRoute || url.pathname.startsWith(`${docsRoute}/`)) &&
    !url.pathname.endsWith(".md")
  ) {
    const slugs = url.pathname
      .slice(docsRoute.length)
      .split("/")
      .filter((v) => v.length > 0);
    if (
      isMarkdownPreferred(request, { markdownMediaTypes: ["text/markdown"] })
    ) {
      const page = source.getPage(slugs);
      if (!page)
        return new Response("Documentation page not found", {
          status: 404,
          headers: { Vary: "Accept" },
        });
      return markdownResponse(await getLLMText(page), true);
    }
    const result = await next();
    const vary = result.response.headers.get("Vary");
    result.response.headers.set("Vary", vary ? `${vary}, Accept` : "Accept");
    return result;
  }

  return next();
});

export const startInstance = createStart(() => {
  return {
    requestMiddleware: [csrfMiddleware, llmMiddleware],
  };
});
