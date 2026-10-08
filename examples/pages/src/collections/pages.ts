import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection } from "@tanstack/react-db";

import { pageApi, type Page } from "@/lib/api";
import { queryClient } from "@/lib/query-client";

export const pageCollection = createCollection(
  queryCollectionOptions<Page>({
    getKey: (page) => page.id,
    queryClient,
    queryKey: ["pages"],
    queryFn: async () => {
      const pages: Page[] = [];
      let page = 1;
      let total = 0;
      do {
        const result = await pageApi.list({ page: page++, limit: 100 });
        pages.push(...result.items);
        total = result.total;
        if (result.items.length === 0) break;
      } while (pages.length < total);
      return pages;
    },
    syncMode: "eager",
  }),
);
