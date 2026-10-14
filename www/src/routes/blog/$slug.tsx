import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import browserCollections from "collections/browser";
import { ArrowLeftIcon } from "lucide-react";
import { Suspense } from "react";
import { BlogMeta } from "@/components/blog-meta";
import { EditOnGitHub } from "@/components/edit-on-github";
import { getMDXComponents } from "@/components/mdx";
import { blogSource } from "@/lib/blog";
import { site } from "@/lib/site";

const loadPost = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(({ data: slug }) => {
    const page = blogSource.getPage([slug]);
    if (!page) throw notFound();
    return {
      path: page.path,
      title: page.data.title,
      description: page.data.description,
      image: new URL(`/og/blog/${slug}.png`, site.url).href,
    };
  });

const clientLoader = browserCollections.blog.createClientLoader({
  component({ default: MDX, frontmatter }, { path }: { path: string }) {
    return (
      <article className="mx-auto max-w-3xl">
        <header className="mb-10 border-b border-border pb-10">
          <BlogMeta {...frontmatter} />
          <h1 className="mt-6 text-4xl font-medium tracking-tight sm:text-6xl">
            {frontmatter.title}
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            {frontmatter.description}
          </p>
          <p className="mt-5 text-sm text-muted-foreground">
            By {frontmatter.author}
          </p>
        </header>
        <div className="prose min-w-0">
          <MDX components={getMDXComponents()} />
        </div>
        <footer className="mt-12 border-t border-border pt-6 text-xs">
          <EditOnGitHub path={`www/content/blog/${path}`} />
        </footer>
      </article>
    );
  },
});

export const Route = createFileRoute("/blog/$slug")({
  loader: async ({ params }) => {
    const post = await loadPost({ data: params.slug });
    await clientLoader.preload(post.path);
    return post;
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.title} — BrickKit` },
          { name: "description", content: loaderData.description },
          { property: "og:title", content: loaderData.title },
          { property: "og:description", content: loaderData.description },
          { property: "og:type", content: "article" },
          { property: "og:image", content: loaderData.image },
          { property: "og:image:width", content: "1200" },
          { property: "og:image:height", content: "630" },
          { property: "og:image:alt", content: loaderData.title },
          { name: "twitter:card", content: "summary_large_image" },
          { name: "twitter:title", content: loaderData.title },
          { name: "twitter:description", content: loaderData.description },
          { name: "twitter:image", content: loaderData.image },
          { name: "twitter:image:alt", content: loaderData.title },
        ]
      : [],
  }),
  component: Post,
});

function Post() {
  const { path } = Route.useLoaderData();
  return (
    <main className="py-10 sm:py-16">
      <Link
        to="/blog"
        className="mb-10 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        All posts
      </Link>
      <Suspense fallback={<p>Loading article…</p>}>
        {clientLoader.useContent(path, { path })}
      </Suspense>
    </main>
  );
}
