/** Child server for the native architecture comparison; started by native.ts. */
import { loadPlans } from "../packages/cli/src/plans";
import { startInProcessHttp } from "../packages/cli/src/native-bridge";
import { Database } from "bun:sqlite";
import { createNativeWorker } from "../packages/cli/src/native-worker";
import { defineService, defineDatabase, sqliteTable, text, t, eq } from "../packages/core/src/index";

const [mode, portArg, path, plansPath] = process.argv.slice(2);
const port = Number(portArg);
const fixed = () => ({ ok: true });
if (mode === "bun") {
  const db = new Database(path!, { readonly: true });
  const get = db.query("SELECT id, title FROM bench_items WHERE id = ?1 LIMIT 1");
  const count = db.query("SELECT count(*) AS n FROM bench_items");
  const select = db.query("SELECT id, title FROM bench_items ORDER BY id ASC LIMIT ?1 OFFSET ?2");
  Bun.serve({ port, hostname: "127.0.0.1", fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/fixed") return Response.json(fixed());
    if (url.pathname.startsWith("/api/item/")) {
      const row = get.get(decodeURIComponent(url.pathname.slice("/api/item/".length)));
      return row ? Response.json(row) : new Response("Not found", { status: 404 });
    }
    if (url.pathname !== "/api/item") return new Response("Not found", { status: 404 });
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      return new Response("Invalid pagination", { status: 400 });
    }
    const total = (count.get() as { n: number }).n;
    const records = select.all(limit, offset) as { id: string; title: string }[];
    const hasMore = offset + records.length < total;
    const last = records.at(-1);
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ v: [last.id, last.id], s: "id" })).toString("base64url") : null;
    return Response.json({ records, items: records, total, limit, offset,
      page: Math.floor(offset / limit) + 1, pageCount: Math.ceil(total / limit), hasMore, nextCursor });
  } });
} else if (mode === "elysia") {
  const { Elysia } = await import("elysia");
  new Elysia().get("/fixed", fixed).listen({ port, hostname: "127.0.0.1" });
} else if (mode === "brick" || mode === "worker" || mode === "inprocess") {
  const table = sqliteTable("bench_items", { id: text("id").primaryKey(), title: text("title").notNull() });
  const database = defineDatabase({ tables: [table], path: path! });
  const service = defineService("bench", { database });
  service.resource({ name: "item", pluralName: "records", table, defaultSort: "id",
    excludeFromList: [], operations: { list: { defaultLimit: 20, maxLimit: 100 } } });
  service.action({ name: "getFixed", path: "/fixed", method: "GET", execute: fixed });
  service.action({ name: "getCustom", execute: () => ({ ok: true, executedBy: "typescript" }) });
  service.action({ name: "getPage", path: "/api/public/pages/:slug", method: "GET",
    input: t.Object({ slug: t.String() }), output: t.Object({ id: t.String(), title: t.String() }),
    errors: { NOT_FOUND: { status: 404, message: "Page not found" } }, execute: async ({ input, ctx, error }) => {
      const [page] = await ctx.db.select().from(table).where(eq(table.id, input.slug));
      if (!page) error.NOT_FOUND("Page not found");
      return page;
    } });
  const createServer = mode === "brick" ? (await import("../packages/cli/src/server")).createBrickServer : createNativeWorker;
  const app = createServer({ services: [service], docs: true, requestLogging: false });
  if (mode === "inprocess") await startInProcessHttp(app as ReturnType<typeof createNativeWorker>, [service], await loadPlans(plansPath!), { port });
  else app.listen({ port, hostname: "127.0.0.1" });
} else {
  throw new Error(`Unknown server mode: ${mode}`);
}
console.log(`${mode} benchmark listening on ${port}`);
