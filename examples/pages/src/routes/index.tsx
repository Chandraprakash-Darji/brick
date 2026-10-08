import { createFileRoute, Link } from "@tanstack/react-router";

import { MarketingLayout } from "../layouts/MarketingLayout";

export const Route = createFileRoute("/")({
  component: LandingPage,
  // SSR title (view-source): replaces the client-only `document.title`
  // effect for first paint; MarketingLayout keeps it in sync afterwards.
  head: () => ({
    meta: [{ title: "Pages — simple publishing" }],
  }),
});

/**
 * Port of app/src/pages/index.astro (landing page).
 */
function LandingPage() {
  return (
    <MarketingLayout title="Pages — simple publishing">
      <div className="tui-home layout mx-auto flex min-h-svh w-11/12 max-w-[42.5rem] flex-col py-20">
        <nav
          className="flex items-center justify-between"
          aria-label="Primary navigation"
        >
          <Link
            to="/"
            className="font-mono text-xs font-bold tracking-tight text-foreground no-underline"
          >
            pages<span className="text-primary">·</span>dev
          </Link>
          <div className="flex items-center gap-5">
            <Link
              to="/docs/$slug"
              params={{ slug: "00-getting-started" }}
              className="accent-link font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              docs
            </Link>
            <Link
              to="/login"
              className="accent-link font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              sign in
            </Link>
            <Link
              to="/signup"
              className="border border-border px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:border-foreground/30"
            >
              get started
            </Link>
          </div>
        </nav>

        <main className="section mt-12 space-y-20">
          <section className="section border border-border">
            <div className="flex items-center gap-4 border-b border-border p-4">
              <div className="flex size-10 items-center justify-center border border-border bg-muted font-mono text-xs text-muted-foreground">
                MD
              </div>
              <div>
                <h1 className="h0 text-xl font-bold tracking-tight">
                  pages·dev
                </h1>
                <p className="mt-0.5 font-mono text-sm text-muted-foreground">
                  Markdown &amp; HTML publishing
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 divide-y divide-border border-b border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <div className="divide-y divide-border">
                <div className="flex items-center gap-2.5 px-3 py-2.5 font-mono text-sm text-muted-foreground">
                  <svg
                    className="size-3.5 shrink-0 text-foreground/50"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                  <span>Write in Markdown or HTML</span>
                </div>
                <div className="flex items-center gap-2.5 px-3 py-2.5 font-mono text-sm text-muted-foreground">
                  <svg
                    className="size-3.5 shrink-0 text-foreground/50"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" x2="22" y1="12" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <span>Get a clean public URL</span>
                </div>
              </div>
              <div className="divide-y divide-border">
                <div className="flex items-center gap-2.5 px-3 py-2.5 font-mono text-sm text-muted-foreground">
                  <svg
                    className="size-3.5 shrink-0 text-foreground/50"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <rect height="14" rx="2" ry="2" width="20" x="2" y="3" />
                    <line x1="8" x2="16" y1="21" y2="21" />
                    <line x1="12" x2="12" y1="17" y2="21" />
                  </svg>
                  <span>Syntax highlighting included</span>
                </div>
                <div className="flex items-center gap-2.5 px-3 py-2.5 font-mono text-sm text-muted-foreground">
                  <svg
                    className="size-3.5 shrink-0 text-foreground/50"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  <span>Zero setup, no build step</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3">
              <Link
                to="/signup"
                className="flex items-center gap-1.5 border border-border px-3 py-1.5 font-mono text-xs text-foreground no-underline transition-colors hover:border-foreground/30"
              >
                Start publishing
                <svg
                  className="size-3"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
              <Link
                to="/login"
                className="accent-link px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                sign in &rarr;
              </Link>
            </div>
          </section>

          <section className="section">
            <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
              How it works
            </span>
            <div className="mt-4 grid grid-cols-1 divide-y divide-border border border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <div className="p-4">
                <span className="font-mono text-[11px] font-medium tracking-widest text-primary uppercase">
                  Write
                </span>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  GitHub Flavored Markdown or raw HTML. Tables, task lists, code
                  blocks with syntax highlighting.
                </p>
              </div>
              <div className="p-4">
                <span className="font-mono text-[11px] font-medium tracking-widest text-primary uppercase">
                  Share
                </span>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Toggle public visibility. Get a clean URL with your slug,
                  instantly live.
                </p>
              </div>
              <div className="p-4">
                <span className="font-mono text-[11px] font-medium tracking-widest text-primary uppercase">
                  Publish
                </span>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  No config files, no deployment, no build step. Write, save,
                  share.
                </p>
              </div>
            </div>
          </section>
        </main>

        <footer className="flex items-center justify-between border-t border-border py-6">
          <span className="font-mono text-xs text-muted-foreground">
            pages<span className="text-primary">·</span>dev &mdash; simple
            publishing
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            &copy; 2026
          </span>
        </footer>
      </div>
    </MarketingLayout>
  );
}
