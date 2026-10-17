import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The URL path of every docs page under `dir`, which the build prerenders. Like
 * Fumadocs, it leaves `(group)` folders out of the path and serves `index` as
 * its folder. Pages in a root folder such as the API reference are not linked
 * from the other pages, so a crawl would never reach them.
 */
export function docsPagePaths(dir: string, prefix = "/docs"): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.isDirectory()) {
        const group = /^\(.+\)$/.test(entry.name);
        return docsPagePaths(
          join(dir, entry.name),
          group ? prefix : `${prefix}/${entry.name}`,
        );
      }
      if (!entry.name.endsWith(".mdx")) return [];
      const slug = entry.name.slice(0, -".mdx".length);
      return [slug === "index" ? prefix : `${prefix}/${slug}`];
    })
    .sort();
}
