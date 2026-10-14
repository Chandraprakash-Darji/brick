import { site } from "./site";

export const marketingPages = {
  "/": { title: site.title, description: site.description },
  "/brand": {
    title: "Brand · Brick",
    description:
      "The Brick identity: the angular knot, logo downloads, usage guidelines, and brand applications.",
  },
  "/blog": {
    title: "Blog — BrickKit",
    description:
      "Framework updates and practical guides for building with BrickKit.",
  },
  "/examples": {
    title: "Examples — BrickKit",
    description:
      "Runnable BrickKit examples with their service graph, routes, database tables and source.",
  },
};

export function socialImagePath(path: string) {
  return `/og${path === "/" ? "/index" : path.replace(/\/$/, "")}.png`;
}

export function socialMeta({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  const image = new URL(socialImagePath(path), site.url).href;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:image", content: image },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: title },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: title },
  ];
}
