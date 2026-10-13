import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import browserCollections from "collections/browser";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "@fumadocs/base-ui/layouts/spacious";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "@fumadocs/base-ui/layouts/spacious/page";
import { Suspense, useState } from "react";

import { AISearch, AISearchPanel } from "@/components/ai/search";
import { Wordmark } from "@/components/logo";
import { useMDXComponents } from "@/components/mdx";
import { baseOptions } from "@/lib/layout.shared";
import { gitConfig } from "@/lib/shared";
import { slugsToMarkdownPath, source } from "@/lib/source";

export const Route = createFileRoute("/docs/$")({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/") ?? [];
    const data = await serverLoader({ data: slugs });
    await clientLoader.preload(data.path);
    return data;
  },
});

const serverLoader = createServerFn({
  method: "GET",
})
  .inputValidator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs);
    if (!page) throw notFound();

    return {
      markdownUrl: slugsToMarkdownPath(page.slugs).url,
      pageTree: await source.serializePageTree(source.getPageTree()),
      path: page.path,
    };
  });

const clientLoader = browserCollections.docs.createClientLoader({
  component(
    { toc, frontmatter, default: MDX },
    // you can define props for the component
    {
      markdownUrl,
      path,
    }: {
      markdownUrl: string;
      path: string;
    },
  ) {
    return (
      <DocsPage
        toc={toc}
        tableOfContent={{
          //   style: "clerk",
        }}
      >
        <DocsTitle className="docs-title">{frontmatter.title}</DocsTitle>
        <DocsDescription className="docs-description">
          {frontmatter.description}
        </DocsDescription>
        <div className="-mt-4 flex flex-row items-center gap-2 border-b pb-6">
          <MarkdownCopyButton markdownUrl={markdownUrl} />
          <ViewOptionsPopover
            markdownUrl={markdownUrl}
            githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/www/content/docs/${path}`}
          />
        </div>
        <DocsBody>
          <MDX components={useMDXComponents()} />
        </DocsBody>
      </DocsPage>
    );
  },
});

function Page() {
  const { path, pageTree, markdownUrl } = useFumadocsLoader(
    Route.useLoaderData(),
  );
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <AISearch open={chatOpen} onOpenChange={setChatOpen}>
      <DocsLayout
        {...baseOptions()}
        nav={{ title: <Wordmark />, url: "/" }}
        themeSwitch={{ enabled: false }}
        tree={pageTree}
        aiChat={{
          open: chatOpen,
          onOpenChange: setChatOpen,
          panel: <AISearchPanel />,
        }}
      >
        <Suspense>
          {clientLoader.useContent(path, { markdownUrl, path })}
        </Suspense>
      </DocsLayout>
    </AISearch>
  );
}
