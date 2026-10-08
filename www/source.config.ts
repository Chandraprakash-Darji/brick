import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { pageSchema } from "fumadocs-core/source/schema";
import { z } from "zod";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export default defineConfig();

export const blog = defineDocs({
  dir: "content/blog",
  docs: {
    schema: pageSchema.extend({
      description: z.string(),
      date: z.iso.date(),
      category: z.enum(["release", "guide"]),
      author: z.string().default("BrickKit team"),
      version: z.string().optional(),
    }),
  },
});
