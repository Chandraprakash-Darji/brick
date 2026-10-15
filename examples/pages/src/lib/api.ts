import { createClient } from "@brickkit/client";
import {
  Api,
  type PageCreateInput,
  type PageUpdateInput,
  type PageUpdateRequest,
} from "../api/contract";

function resolveBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE;
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.BACKEND_ORIGIN ?? "http://localhost:5174";
}

const { client, dispose } = createClient(Api, {
  baseUrl: resolveBaseUrl(),
  fetchOptions: { credentials: "include" },
});
const page = client.pages;

export const pageApi = {
  get: (input: { id: string }) => page["page.get"]({ params: input }),
  create: (input: PageCreateInput) => page["page.create"]({ payload: input }),
  update: (input: PageUpdateRequest) =>
    page["page.update"]({ params: { id: input.id }, payload: input.data }),
  delete: (input: { id: string }) => page["page.delete"]({ params: input }),
  list: (input: { limit?: number; offset?: number; includeTotal?: boolean }) =>
    page["page.list"]({ payload: input }),
};

export type { PageCreateInput, PageUpdateInput };
export type Page = Awaited<ReturnType<typeof pageApi.get>>;
export type PageListItem = Page;

if (import.meta.hot) import.meta.hot.dispose(() => void dispose());
