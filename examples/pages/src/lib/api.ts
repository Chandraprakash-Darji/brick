import { createBrickClient } from "@brickkit/core/client";
import type { PagesApi } from "../api/contract";

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

export const pageApi = api.page;
export type Page = Awaited<ReturnType<typeof pageApi.get>>;
export type PageCreateInput = Parameters<typeof pageApi.create>[0];
export type PageUpdateInput = Omit<Parameters<typeof pageApi.update>[0], "id">;
export type PageListItem = Awaited<
  ReturnType<typeof pageApi.list>
>["items"][number] & { id: string };
