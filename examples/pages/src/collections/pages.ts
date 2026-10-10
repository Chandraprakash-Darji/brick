import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection } from "@tanstack/react-db";

import { pageApi, type PageListItem } from "@/lib/api";
import { queryClient } from "@/lib/query-client";

export const pageCollection = createCollection(
  queryCollectionOptions<PageListItem>({
    getKey: (page) => page.id,
    queryClient,
    queryKey: ["pages"],
    queryFn: async () => {
      const pages: PageListItem[] = [];
      let offset = 0;
      let total = 0;
      do {
        const result = await pageApi.list({
          offset,
          limit: 100,
          includeTotal: true,
        });
        for (const item of result.items) {
          if (typeof item.id !== "string")
            throw new Error("Page list item is missing its ID");
          pages.push({ ...item, id: item.id });
        }
        offset += result.items.length;
        total = result.total ?? pages.length;
        if (result.items.length === 0) break;
      } while (pages.length < total);
      return pages;
    },
    syncMode: "eager",
  }),
);
