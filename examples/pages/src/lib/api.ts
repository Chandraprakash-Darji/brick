import { createBrickClient } from "@brickkit/core/client";
import type { PagesApi } from "../api/contract";
import type { Page, pagesTable } from "../api/services/pages/page/model";

function resolveBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE as string | undefined;
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.BACKEND_ORIGIN ?? "http://localhost:5174";
}

// Backend imports above are erased: only the browser-safe SDK is bundled.
export const api = createBrickClient<PagesApi>({
  baseUrl: resolveBaseUrl(),
  fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
});

export type { Page };
export type PageCreateInput = Omit<
  typeof pagesTable.$inferInsert,
  "id" | "userId" | "createdAt" | "updatedAt"
>;
export type PageUpdateInput = Partial<PageCreateInput>;

// Resource actions currently erase their schema types in Brick. Keep this
// app boundary typed from the same Drizzle table until resource inference lands.
export const pageApi = {
  create: (input: PageCreateInput): Promise<Page> => api.page.create(input),
  get: (input: { id: string }): Promise<Page> => api.page.get(input),
  list: (
    input: { page?: number; limit?: number } = {},
  ): Promise<{
    items: Page[];
    total: number;
  }> => api.page.list(input),
  update: (input: PageUpdateInput & { id: string }): Promise<Page> =>
    api.page.update(input),
  delete: (input: { id: string }): Promise<unknown> => api.page.delete(input),
};
