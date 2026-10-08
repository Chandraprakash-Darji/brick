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
      let page = 1;
      let total = 0;
      do {
        const result = await pageApi.list({ page: page++, limit: 100 });
        for (const item of result.items) {
          if (typeof item.id !== "string")
            throw new Error("Page list item is missing its ID");
          pages.push({ ...item, id: item.id });
        }
        total = result.total;
        if (result.items.length === 0) break;
      } while (pages.length < total);
      return pages;
    },
    syncMode: "eager",
  }),
);
