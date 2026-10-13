import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRightIcon } from "lucide-react";
import { exampleStats, getExamples } from "@/lib/examples";

const title = "Examples — BrickKit";
const description =
  "Runnable BrickKit examples with their service graph, routes, database tables and source.";

export const Route = createFileRoute("/examples/")({
  loader: () => getExamples(),
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: Examples,
});

function Examples() {
  const examples = Route.useLoaderData();
  return (
    <main className="py-14 sm:py-20">
      <header className="mb-14 max-w-3xl">
        <p className="label mb-5 text-gopher">EXAMPLES</p>
        <h1 className="text-5xl font-medium tracking-tight sm:text-7xl">
          Real apps.
          <br />
          Real service graphs.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Every example is runnable in this repository. Explore its
          architecture, routes, tables and source before you clone it.
        </p>
      </header>
      <section
        aria-label="Examples"
        className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        {examples.map((example) => {
          const stats = exampleStats(example);
          return (
            <Link
              key={example.slug}
              to="/examples/$slug"
              params={{ slug: example.slug }}
              className="group flex flex-col rounded-lg border bg-card p-6 transition-colors hover:border-foreground/25"
            >
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-2xl font-medium tracking-tight transition-colors group-hover:text-gopher">
                  {example.title}
                </h2>
                <ArrowUpRightIcon className="mt-1 size-5 shrink-0 transition-colors group-hover:text-gopher" />
              </div>
              <p className="mt-3 flex-1 leading-relaxed text-muted-foreground">
                {example.description}
              </p>
              <ul className="mt-5 flex flex-wrap gap-2">
                {example.tags.map((tag) => (
                  <li
                    key={tag}
                    className="border border-border px-2 py-1 font-mono text-xs"
                  >
                    {tag}
                  </li>
                ))}
              </ul>
              <ul className="mt-5 space-y-1.5 text-sm text-muted-foreground">
                {example.features.slice(0, 3).map((feature) => (
                  <li key={feature}>— {feature}</li>
                ))}
              </ul>
              <p className="mt-5 flex items-center justify-between gap-3 border-t pt-4 font-mono text-xs text-muted-foreground">
                <span>
                  {stats.services} services · {stats.actions} actions ·{" "}
                  {stats.tables} tables
                </span>
                {example.demo && (
                  <span className="text-gopher-ink">Live demo</span>
                )}
              </p>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
