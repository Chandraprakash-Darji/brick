import { loader } from "fumadocs-core/source";
import { blog } from "collections/server";

export const blogSource = loader({
  source: blog.toFumadocsSource(),
  baseUrl: "/blog",
});

export function getBlogPosts() {
  return blogSource
    .getPages()
    .map((page) => ({
      slug: page.slugs.join("/"),
      title: page.data.title,
      description: page.data.description,
      date: page.data.date,
      category: page.data.category,
      author: page.data.author,
      version: page.data.version,
    }))
    .sort(
      (a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug),
    );
}
