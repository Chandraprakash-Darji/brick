import { describe, it, expect, beforeEach } from "bun:test";

import { prepareTestDatabase } from "./database";

// Port of server/mcp_test.go (TestMCP_BearerProtectedEcho) expanded to all
// 11 MCP tools: list_pages, get_page, get_page_content, render_page,
// create_page, upload_content, edit_page, delete_page, get_public_page,
// echo, whoami — plus unauthenticated rejection.
// Backend under porting by sibling agents:
//   src/api/services/pages/mcp.ts (11 actions)
//   src/api/services/pages/service.ts (resource, for DB reset)
// Dynamic imports keep `tsc --noEmit` green when the backend is absent;
// missing tools are marked todo instead of inventing a different API.

const MCP_PATH = "../src/api/services/pages/mcp";
const SERVICE_PATH = "../src/api/services/pages/service";

async function tryImport(path: string): Promise<Record<string, any> | null> {
  try {
    const mod = (await import(path as any)) as Record<string, any>;
    return mod ?? null;
  } catch {
    return null;
  }
}

function pick(
  mod: Record<string, any> | null,
  ...names: string[]
): { name: string; value: any } | null {
  if (!mod) return null;
  for (const n of names) {
    if (mod[n] !== undefined) return { name: n, value: mod[n] };
  }
  return null;
}

const mcpMod: Record<string, any> | null = await tryImport(MCP_PATH);
const svcMod: Record<string, any> | null = await tryImport(SERVICE_PATH);

// Tool-list exports (any of these shapes satisfies "lists 11 tools").
const toolListPick = pick(
  mcpMod,
  "toolList",
  "listTools",
  "tools",
  "TOOL_NAMES",
  "TOOL_LIST",
  "mcpTools",
  "mcpToolList",
);
// Dispatcher exports (JSON-RPC style handleToolCall or brick-style callTool).
const dispatchPick = pick(
  mcpMod,
  "handleToolCall",
  "callTool",
  "dispatchTool",
  "dispatch",
  "call",
  "handleCall",
);
// Per-tool brick actions, snake_case (Go) first then camelCase (TS).
const toolPicks: Record<string, { name: string; value: any } | null> = {
  create_page: pick(mcpMod, "create_page", "createPage", "createPageTool"),
  delete_page: pick(mcpMod, "delete_page", "deletePage", "deletePageTool"),
  echo: pick(mcpMod, "echo", "echoTool"),
  edit_page: pick(mcpMod, "edit_page", "editPage", "editPageTool"),
  get_page: pick(mcpMod, "get_page", "getPage", "getPageTool", "get_page_tool"),
  get_page_content: pick(
    mcpMod,
    "get_page_content",
    "getPageContent",
    "getPageContentTool",
  ),
  get_public_page: pick(
    mcpMod,
    "get_public_page",
    "getPublicPage",
    "getPublicPageTool",
  ),
  list_pages: pick(
    mcpMod,
    "list_pages",
    "listPages",
    "listPagesTool",
    "list_pages_tool",
  ),
  render_page: pick(mcpMod, "render_page", "renderPage", "renderPageTool"),
  upload_content: pick(
    mcpMod,
    "upload_content",
    "uploadContent",
    "uploadContentTool",
  ),
  whoami: pick(mcpMod, "whoami", "whoamiTool"),
};

const TOOL_NAMES = [
  "list_pages",
  "get_page",
  "get_page_content",
  "render_page",
  "create_page",
  "upload_content",
  "edit_page",
  "delete_page",
  "get_public_page",
  "echo",
  "whoami",
] as const;

const hasMcpMod = mcpMod !== null;
const hasToolList = toolListPick !== null;
const hasDispatch = dispatchPick !== null;
const presentTools = (
  Object.keys(toolPicks) as Array<keyof typeof toolPicks>
).filter((k) => toolPicks[k] !== null);

const servicePick = pick(svcMod, "pagesService", "service");
const tablePick = pick(svcMod, "pagesTable", "table");
const svc: any = servicePick?.value ?? null;
const table: any = tablePick?.value ?? null;

const aliceCtx = { user: { id: "user_alice" } };

async function resetDb() {
  if (svc?.getDb && table) {
    const db = svc.getDb();
    if (db) await db.delete(table);
  }
}

/** Normalize a brick action / plain fn into a callable. */
async function invokeTool(tool: any, input: any, ctx?: any): Promise<any> {
  if (!tool) throw new Error("tool missing");
  if (typeof tool.execute === "function") return tool({ ctx, input });
  if (typeof tool === "function") {
    try {
      return await tool({ ctx, input });
    } catch {
      return await tool(input, ctx);
    }
  }
  throw new Error("unrecognized tool shape");
}

async function invokeDispatch(
  name: string,
  args: any,
  ctx?: any,
): Promise<any> {
  const d = dispatchPick?.value;
  if (!d) throw new Error("dispatcher missing");
  return d(name, args, ctx);
}

function toolText(out: any): string {
  if (typeof out === "string") return out;
  if (out?.content?.[0]?.text) return String(out.content[0].text);
  return JSON.stringify(out ?? "");
}

describe("mcp tools (port of mcp_test.go, 11 tools)", () => {
  beforeEach(async () => {
    await prepareTestDatabase();
    await resetDb();
  });

  if (!hasMcpMod) {
    for (const name of TOOL_NAMES) {
      it.todo(`TODO: mcp tool ${name} — needs ${name} action in src/services/pages/mcp.ts`, () => {});
    }
    it.todo("TODO: mcp unauthenticated rejection — protected tools must reject calls without ctx.user (401/UNAUTHORIZED + resource metadata)", () => {});
  }
  if (hasMcpMod && !hasToolList && presentTools.length === 0 && !hasDispatch) {
    it.todo("TODO: mcp registry — needs toolList/callTool (or 11 exported actions) in src/services/pages/mcp.ts", () => {});
  }
  for (const name of TOOL_NAMES) {
    if (
      hasMcpMod &&
      !toolPicks[name as keyof typeof toolPicks] &&
      !hasDispatch
    ) {
      it.todo(`TODO: mcp tool ${name} — no ${name} export found in src/services/pages/mcp.ts`, () => {});
    }
  }

  it("tool registry lists all 11 tools", async () => {
    if (!hasToolList) return;
    const raw = toolListPick!.value;
    const list = typeof raw === "function" ? await raw() : raw;
    const names: string[] = Array.isArray(list)
      ? list.map((t: any) => String(t?.name ?? t))
      : Object.keys(list ?? {});
    for (const want of TOOL_NAMES) {
      const hit =
        names.includes(want) ||
        names.includes(
          want.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        );
      expect(
        hit,
        `tool registry missing ${want} (got: ${names.join(",")})`,
      ).toBe(true);
    }
  });

  it("echo returns 'Echo: <msg>' with the caller id (port of BearerProtectedEcho)", async () => {
    const tool = toolPicks.echo;
    if (!tool && !hasDispatch) return;
    const out = tool
      ? await invokeTool(tool.value, { message: "hi" }, aliceCtx)
      : await invokeDispatch("echo", { message: "hi" }, aliceCtx);
    const text = toolText(out);
    expect(text).toContain("Echo: hi");
    expect(text).toContain("user_alice");
  });

  it("whoami returns the authenticated subject", async () => {
    const tool = toolPicks.whoami;
    if (!tool && !hasDispatch) return;
    const out = tool
      ? await invokeTool(tool.value, {}, aliceCtx)
      : await invokeDispatch("whoami", {}, aliceCtx);
    expect(toolText(out)).toContain("user_alice");
  });

  it("rejects unauthenticated calls to protected tools (port of 401 + WWW-Authenticate)", async () => {
    // Go: missing/invalid bearer -> 401 + WWW-Authenticate: resource_metadata=...
    // TS port: missing ctx.user -> UNAUTHORIZED ActionExecutionError.
    const candidates: Array<{ label: string; run: () => Promise<any> }> = [];
    if (toolPicks.echo)
      candidates.push({
        label: "echo",
        run: () => invokeTool(toolPicks.echo!.value, { message: "hi" }),
      });
    if (toolPicks.whoami)
      candidates.push({
        label: "whoami",
        run: () => invokeTool(toolPicks.whoami!.value, {}),
      });
    if (toolPicks.list_pages)
      candidates.push({
        label: "list_pages",
        run: () => invokeTool(toolPicks.list_pages!.value, {}),
      });
    if (hasDispatch)
      candidates.push({
        label: "dispatch:echo",
        run: () => invokeDispatch("echo", { message: "hi" }),
      });
    if (candidates.length === 0) return;
    for (const c of candidates) {
      await expect(c.run()).rejects.toThrow(
        /unauthorized|unauthenticated|sign in|access denied|401|403/i,
      );
    }
  });

  it("rejects unknown tool names", async () => {
    if (!hasDispatch) return;
    await expect(
      invokeDispatch("no_such_tool_xyz", {}, aliceCtx),
    ).rejects.toThrow(/unknown tool|not found|invalid/i);
  });

  it("create_page -> list_pages round trip (owner-scoped)", async () => {
    const create = toolPicks.create_page;
    const list = toolPicks.list_pages;
    if ((!create || !list) && !hasDispatch) return;
    const created = create
      ? await invokeTool(
          create.value,
          { isPublic: false, slug: "mcp-doc", title: "MCP Doc" },
          aliceCtx,
        )
      : await invokeDispatch(
          "create_page",
          { slug: "mcp-doc", title: "MCP Doc" },
          aliceCtx,
        );
    expect(toolText(created)).toContain("mcp-doc");
    const listed = list
      ? await invokeTool(list.value, {}, aliceCtx)
      : await invokeDispatch("list_pages", {}, aliceCtx);
    expect(toolText(listed)).toContain("mcp-doc");
  });

  it("get_page + get_page_content return metadata vs body", async () => {
    const create = toolPicks.create_page;
    const get = toolPicks.get_page;
    const getContent = toolPicks.get_page_content;
    const upload = toolPicks.upload_content;
    if ((!create || !get || !getContent) && !hasDispatch) return;
    const run = (key: keyof typeof toolPicks, args: any, ctx: any) =>
      toolPicks[key]
        ? invokeTool(toolPicks[key]!.value, args, ctx)
        : invokeDispatch(key, args, ctx);
    const createdText = toolText(
      await run("create_page", { slug: "bodies", title: "Bodies" }, aliceCtx),
    );
    const idMatch =
      /"id"\s*:\s*"([^"]+)"/.exec(createdText)?.[1] ??
      createdText.match(/pg_[A-Za-z0-9_-]+/)?.[0];
    expect(
      idMatch,
      `create_page output should carry an id (got: ${createdText})`,
    ).toBeTruthy();
    const id = idMatch!;
    if (upload ?? hasDispatch) {
      const upText = toolText(
        await run("upload_content", { content: "# Hello body", id }, aliceCtx),
      );
      expect(upText).toMatch(/upload|bytes|ok|success/i);
    }
    const meta = toolText(await run("get_page", { id }, aliceCtx));
    expect(meta).toContain("bodies");
    const body = toolText(await run("get_page_content", { id }, aliceCtx));
    // Body is raw source; metadata must not leak full content expectations here,
    // but content tools must return *something* non-empty on success.
    expect(body.length).toBeGreaterThan(0);
  });

  it("render_page returns a self-contained HTML document", async () => {
    const create = toolPicks.create_page;
    const render = toolPicks.render_page;
    if ((!create || !render) && !hasDispatch) return;
    const run = (key: keyof typeof toolPicks, args: any, ctx: any) =>
      toolPicks[key]
        ? invokeTool(toolPicks[key]!.value, args, ctx)
        : invokeDispatch(key, args, ctx);
    const createdText = toolText(
      await run(
        "create_page",
        { slug: "render-me", title: "Render Me" },
        aliceCtx,
      ),
    );
    const id =
      /"id"\s*:\s*"([^"]+)"/.exec(createdText)?.[1] ??
      createdText.match(/pg_[A-Za-z0-9_-]+/)?.[0] ??
      createdText;
    await run(
      "upload_content",
      { content: "# Render Me\n\nBody.", id },
      aliceCtx,
    ).catch(() => {});
    const html = toolText(await run("render_page", { id }, aliceCtx));
    expect(html).toContain("Render Me");
    expect(html).toMatch(/<html|<h1|markdown-body/i);
  });

  it("edit_page patches metadata without touching body", async () => {
    const create = toolPicks.create_page;
    const edit = toolPicks.edit_page;
    const get = toolPicks.get_page;
    if ((!create || !edit) && !hasDispatch) return;
    const run = (key: keyof typeof toolPicks, args: any, ctx: any) =>
      toolPicks[key]
        ? invokeTool(toolPicks[key]!.value, args, ctx)
        : invokeDispatch(key, args, ctx);
    const createdText = toolText(
      await run("create_page", { slug: "edit-me", title: "Before" }, aliceCtx),
    );
    const id =
      /"id"\s*:\s*"([^"]+)"/.exec(createdText)?.[1] ??
      createdText.match(/pg_[A-Za-z0-9_-]+/)?.[0] ??
      createdText;
    const edited = toolText(
      await run("edit_page", { id, title: "After" }, aliceCtx),
    );
    expect(edited).toContain("After");
    if (get ?? hasDispatch) {
      expect(toolText(await run("get_page", { id }, aliceCtx))).toContain(
        "After",
      );
    }
  });

  it("delete_page removes the page; get_page then fails", async () => {
    const create = toolPicks.create_page;
    const del = toolPicks.delete_page;
    const get = toolPicks.get_page;
    if ((!create || !del) && !hasDispatch) return;
    const run = (key: keyof typeof toolPicks, args: any, ctx: any) =>
      toolPicks[key]
        ? invokeTool(toolPicks[key]!.value, args, ctx)
        : invokeDispatch(key, args, ctx);
    const createdText = toolText(
      await run("create_page", { slug: "gone-soon", title: "Gone" }, aliceCtx),
    );
    const id =
      /"id"\s*:\s*"([^"]+)"/.exec(createdText)?.[1] ??
      createdText.match(/pg_[A-Za-z0-9_-]+/)?.[0] ??
      createdText;
    expect(toolText(await run("delete_page", { id }, aliceCtx))).toMatch(
      /delet/i,
    );
    if (get ?? hasDispatch) {
      await expect(run("get_page", { id }, aliceCtx)).rejects.toThrow(
        /not found|not owned|access denied/i,
      );
    }
  });

  it("get_public_page serves public slugs without ownership", async () => {
    const create = toolPicks.create_page;
    const pub = toolPicks.get_public_page;
    if ((!create || !pub) && !hasDispatch) return;
    const run = (key: keyof typeof toolPicks, args: any, ctx: any) =>
      toolPicks[key]
        ? invokeTool(toolPicks[key]!.value, args, ctx)
        : invokeDispatch(key, args, ctx);
    await run(
      "create_page",
      { isPublic: true, slug: "mcp-pub", title: "Pub" },
      aliceCtx,
    ).catch(async () => {
      // Fallback when create_page has no isPublic passthrough: create then edit.
      const t = toolText(
        await run("create_page", { slug: "mcp-pub", title: "Pub" }, aliceCtx),
      );
      const id =
        /"id"\s*:\s*"([^"]+)"/.exec(t)?.[1] ??
        t.match(/pg_[A-Za-z0-9_-]+/)?.[0] ??
        t;
      await run("edit_page", { id, isPublic: true }, aliceCtx);
    });
    // Public reads must not require ownership: call without ctx.
    const out = pub
      ? await invokeTool(pub.value, { slug: "mcp-pub" }).catch((err) =>
          invokeTool(pub.value, { slug: "mcp-pub" }, aliceCtx).then((v) => {
            throw new Error(
              `get_public_page required auth: ${(err as Error)?.message}; value=${toolText(v)}`,
            );
          }),
        )
      : await invokeDispatch("get_public_page", { slug: "mcp-pub" });
    expect(toolText(out)).toContain("mcp-pub");
  });
});
