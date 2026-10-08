import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { docs } from "../routes/-docs";
import { MarketingLayout } from "./MarketingLayout";

interface DocLayoutProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * Port of app/src/layouts/DocLayout.astro.
 * Sidebar index + article wrapper around the rendered markdown.
 */
export function DocLayout({ title, description, children }: DocLayoutProps) {
  return (
    <MarketingLayout title={`${title} — Docs — Pages`}>
      <article className="layout-wide mx-auto flex min-h-svh w-11/12 max-w-[68rem] py-12">
        <aside className="hidden w-56 shrink-0 md:block">
          <nav className="sticky top-12 space-y-1">
            <Link
              to="/docs"
              className="mb-3 block font-mono text-xs font-bold tracking-tight text-foreground no-underline"
            >
              docs<span className="text-primary">·</span>pages
            </Link>
            <Link
              to="/"
              className="accent-link mb-4 block font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              &larr; home
            </Link>
            <p className="px-2 pt-2 pb-1 font-mono text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
              index
            </p>
            {docs.map((doc) => (
              <Link
                key={doc.slug}
                to="/docs/$slug"
                params={{ slug: doc.slug }}
                className="block rounded-none px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {doc.title}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 flex-1 md:pl-12">
          <span className="font-mono text-[10px] font-medium tracking-widest text-primary uppercase">
            Documentation
          </span>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {description}
            </p>
          )}
          <div className="lg:prose-md relative prose w-full max-w-none py-4 dark:prose-invert prose-a:no-underline">
            {children}
          </div>
        </div>
      </article>
    </MarketingLayout>
  );
}
