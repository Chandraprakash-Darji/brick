import { createFileRoute, Link } from "@tanstack/react-router";

import { getDoc, renderMarkdown } from "../-docs";
import { DocLayout } from "../../layouts/DocLayout";
import { MarketingLayout } from "../../layouts/MarketingLayout";

export const Route = createFileRoute("/docs/$slug")({
  component: DocEntryPage,
  // SSR title (view-source), mirroring the old
  // `{frontmatter.title} — Docs — Pages` BaseLayout title.
  head: ({ params }) => {
    const doc = getDoc(params.slug);
    return {
      meta: [
        {
          title: doc
            ? `${doc.title} — Docs — Pages`
            : "Not found — Docs — Pages",
        },
      ],
    };
  },
});

/**
 * Port of app/src/pages/docs/[slug].astro (Astro getStaticPaths ->
 * client-side lookup over the bundled docs collection).
 */
function DocEntryPage() {
  const { slug } = Route.useParams();
  const doc = getDoc(slug);

  if (!doc) {
    return (
      <MarketingLayout title="Not found — Docs — Pages">
        <div className="layout mx-auto flex min-h-svh w-11/12 max-w-[42.5rem] flex-col py-20">
          <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            No documentation page for “{slug}”.
          </p>
          <Link
            to="/docs"
            className="accent-link mt-8 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            &larr; all docs
          </Link>
        </div>
      </MarketingLayout>
    );
  }

  return (
    <DocLayout title={doc.title} description={doc.description}>
      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.body) }} />
    </DocLayout>
  );
}
