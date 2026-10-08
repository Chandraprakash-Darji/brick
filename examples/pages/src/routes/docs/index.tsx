import { createFileRoute, Link } from "@tanstack/react-router";

import { docs } from "../-docs";
import { MarketingLayout } from "../../layouts/MarketingLayout";

export const Route = createFileRoute("/docs/")({
  component: DocsIndexPage,
  // SSR title (view-source): replaces the client-only `document.title`
  // effect for first paint; MarketingLayout keeps it in sync afterwards.
  head: () => ({
    meta: [{ title: "Docs — Pages" }],
  }),
});

/**
 * Port of app/src/pages/docs/index.astro.
 */
function DocsIndexPage() {
  return (
    <MarketingLayout title="Docs — Pages">
      <div className="layout mx-auto flex min-h-svh w-11/12 max-w-[42.5rem] flex-col py-20">
        <nav
          className="flex items-center justify-between"
          aria-label="Primary navigation"
        >
          <Link
            to="/docs"
            className="font-mono text-xs font-bold tracking-tight text-foreground no-underline"
          >
            docs<span className="text-primary">·</span>pages
          </Link>
          <Link
            to="/"
            className="accent-link font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            &larr; home
          </Link>
        </nav>

        <main className="section mt-12">
          <span className="font-mono text-[10px] font-medium tracking-widest text-primary uppercase">
            Documentation
          </span>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            Documentation
          </h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            {docs.length} page{docs.length !== 1 ? "s" : ""}
          </p>

          <div className="mt-8 flex flex-col divide-y divide-border border border-border">
            {docs.map((doc) => (
              <Link
                key={doc.slug}
                to="/docs/$slug"
                params={{ slug: doc.slug }}
                className="group flex items-center justify-between px-4 py-3.5 no-underline transition-colors hover:bg-muted"
              >
                <div>
                  <span className="text-sm font-medium text-foreground group-hover:text-foreground">
                    {doc.title}
                  </span>
                  {doc.description && (
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {doc.description}
                    </p>
                  )}
                </div>
                <svg
                  className="size-4 shrink-0 text-muted-foreground"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </Link>
            ))}
          </div>
        </main>

        <footer className="mt-20 border-t border-border py-6">
          <span className="font-mono text-xs text-muted-foreground">
            pages<span className="text-primary">·</span>dev &mdash; simple
            publishing
          </span>
        </footer>
      </div>
    </MarketingLayout>
  );
}
