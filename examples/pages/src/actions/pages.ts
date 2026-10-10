import { createOptimisticAction } from "@tanstack/react-db";

import { pageApi, type PageCreateInput, type PageUpdateInput } from "@/lib/api";
import { pageCollection } from "@/collections/pages";

// createPageAction optimistically inserts a page, then creates it on the
// server and refetches the collection.
export const createPageAction = createOptimisticAction<PageCreateInput>({
  mutationFn: async (body) => {
    await pageApi.create(body);
    await pageCollection.utils.refetch();
  },
  onMutate: (body) => {
    pageCollection.insert({
      createdAt: new Date().toISOString(),
      id: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
      contentType: "markdown",
      theme: "github-dark",
      isPublic: false,
      userId: null,
      ...body,
    });
  },
});

// updatePageAction optimistically patches a page, then persists it.
export const updatePageAction = createOptimisticAction<
  { id: string } & PageUpdateInput
>({
  mutationFn: async ({ id, ...body }) => {
    await pageApi.update({ id, data: body });
    await pageCollection.utils.refetch();
  },
  onMutate: ({ id, ...body }) => {
    pageCollection.update(id, (draft) => {
      Object.assign(draft, body);
    });
  },
});

// deletePageAction optimistically removes a page, then deletes it server-side.
export const deletePageAction = createOptimisticAction<{ id: string }>({
  mutationFn: async ({ id }) => {
    await pageApi.delete({ id });
    await pageCollection.utils.refetch();
  },
  onMutate: ({ id }) => {
    pageCollection.delete(id);
  },
});
