import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ArrowUpRightIcon } from "lucide-react";
import { BlogMeta } from "@/components/blog-meta";
import { getBlogPosts } from "@/lib/blog";

const loadPosts = createServerFn({ method: "GET" }).handler(() =>
  getBlogPosts(),
);

export const Route = createFileRoute("/blog/")({
  loader: () => loadPosts(),
  head: () => ({
    meta: [
      { title: "Blog — BrickKit" },
      {
        name: "description",
        content:
          "Framework updates and practical guides for building with BrickKit.",
      },
      { property: "og:title", content: "Blog — BrickKit" },
      {
        property: "og:description",
        content:
          "Framework updates and practical guides for building with BrickKit.",
      },
    ],
  }),
  component: Blog,
});

function Blog() {
  const posts = Route.useLoaderData();
  return (
    <main className="py-14 sm:py-20">
      <header className="mb-14 max-w-3xl">
        <p className="label mb-5 text-gopher">THE BRICKKIT BLOG</p>
        <h1 className="text-5xl font-medium tracking-tight sm:text-7xl">
          Updates. Ideas.
          <br />
          Things you can build.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Follow each framework upgrade and learn how to build typed backends,
          APIs, and tools with BrickKit.
        </p>
      </header>
      <section aria-label="Blog posts" className="border-t border-border">
        {posts.map((post) => (
          <article key={post.slug} className="border-b border-border">
            <Link
              to="/blog/$slug"
              params={{ slug: post.slug }}
              className="group grid gap-5 py-9 sm:grid-cols-[240px_1fr] sm:gap-10 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <BlogMeta {...post} />
              <div>
                <div className="flex items-start justify-between gap-6">
                  <h2 className="text-2xl font-medium tracking-tight transition-colors group-hover:text-gopher sm:text-3xl">
                    {post.title}
                  </h2>
                  <ArrowUpRightIcon className="mt-1 size-5 shrink-0 transition-colors group-hover:text-gopher" />
                </div>
                <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">
                  {post.description}
                </p>
                <p className="mt-4 text-xs text-muted-foreground">
                  By {post.author}
                </p>
              </div>
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
