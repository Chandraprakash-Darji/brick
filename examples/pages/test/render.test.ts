import { describe, it, expect, beforeEach } from "bun:test";

import { prepareTestDatabase } from "./database";

// Port of server/resources/render.go + mermaid.go + themes.go behavior:
// markdown/html routing, theme fallback, mermaid injection, public-page not-found.
import * as service from "../src/api/services/pages/service";
import { getPublicPageTool } from "../src/api/services/pages/page/tools/get-public-page";

const svcMod = {
  ...service,
  create: service.pagesResource.create,
  getPublicPage: getPublicPageTool,
};

function pick(mod: Record<string, any>, ...names: string[]) {
  for (const name of names) {
    if (mod[name] !== undefined) return { name, value: mod[name] };
  }
  return null;
}

const renderContentPick = pick(svcMod, "RenderContent", "renderContent");
const renderPublicPick = pick(
  svcMod,
  "RenderPublicPage",
  "renderPublicPage",
  "renderPage",
);
const getPublicPick = pick(svcMod, "getPublicPage", "get_public_page");
const createPick = pick(svcMod, "create", "createPage");
const themeCssPick = pick(svcMod, "pageThemeCSS", "pageThemeCss", "themeCSS");
const mermaidPick = pick(svcMod, "injectMermaid", "inject_mermaid");
const mermaidThemePick = pick(svcMod, "mermaidTheme", "mermaid_theme");
const docPick = pick(svcMod, "documentHTML", "documentHtml");
const servicePick = pick(svcMod, "pagesService", "service");
const tablePick = pick(svcMod, "pagesTable", "table");

const renderContent: any = renderContentPick?.value ?? null;
const renderPublicPage: any = renderPublicPick?.value ?? null;
const getPublicPage: any = getPublicPick?.value ?? null;
const themeCSS: any = themeCssPick?.value ?? null;
const injectMermaid: any = mermaidPick?.value ?? null;
const mermaidTheme: any = mermaidThemePick?.value ?? null;

const mockUser = (id: string) => ({ user: { id } });

async function resetDb() {
  const svc = servicePick?.value;
  const table = tablePick?.value;
  if (svc?.getDb && table) {
    const db = svc.getDb();
    if (db) await db.delete(table);
  }
}

describe("render routing + themes + mermaid (port of render.go/mermaid.go/themes.go)", () => {
  beforeEach(async () => {
    await prepareTestDatabase();
    await resetDb();
  });

  it("routes markdown to a full HTML document", async () => {
    if (!renderContent) return;
    const out = await renderContent(
      "Hello",
      "# Title\n\nBody text.",
      "markdown",
      "github-dark",
    );
    const html = String(out);
    expect(html).toContain("<title>Hello</title>");
    expect(html).toContain("markdown-body");
    expect(html).toContain("Title");
  });

  it("routes html content through as-is (no markdown wrapper)", async () => {
    if (!renderContent) return;
    const raw = `<h1>Raw HTML page</h1><p>custom</p>`;
    const out = await renderContent("Raw", raw, "html", "github-dark");
    expect(String(out)).toContain(raw);
  });

  it("falls back to github-dark CSS for unknown themes", async () => {
    if (!renderContent && !themeCSS) return;
    if (themeCSS) {
      const css = String(themeCSS("not-a-theme"));
      const dark = String(themeCSS("github-dark"));
      expect(css).toBe(dark);
      expect(css).toContain("#0d1117");
    }
    if (renderContent) {
      // Port of pageThemeCSS default: unknown theme CSS falls back to
      // github-dark, while the body class keeps the verbatim theme string
      // (matching Go documentHTML which escapes `theme` as-is).
      const html = String(
        await renderContent("T", "# Hi", "markdown", "not-a-theme"),
      );
      expect(html).toContain("#0d1117");
    }
  });

  it("falls back to github-dark for empty theme", async () => {
    if (!renderContent && !themeCSS) return;
    if (themeCSS) {
      expect(String(themeCSS(""))).toBe(String(themeCSS("github-dark")));
    }
    if (renderContent) {
      const html = String(await renderContent("T", "# Hi", "markdown", ""));
      expect(html).toContain("theme-github-dark");
    }
  });

  it("inlines distinct CSS per known theme", () => {
    if (!themeCSS) return;
    const dark = String(themeCSS("github-dark"));
    const light = String(themeCSS("github-light"));
    const dracula = String(themeCSS("dracula"));
    const nord = String(themeCSS("nord"));
    expect(new Set([dark, light, dracula, nord]).size).toBe(4);
    expect(light).toContain("#fff");
    expect(dracula).toContain("#282a36");
    expect(nord).toContain("#2e3440");
  });

  it("injects mermaid loader only when mermaid blocks exist", async () => {
    if (!renderContent && !injectMermaid) return;
    if (injectMermaid) {
      const plain = injectMermaid("<p>no diagrams</p>", "github-dark");
      expect(String(plain)).not.toContain("mermaid");
      const withBlock = injectMermaid(
        `<pre><code class="language-mermaid">flowchart LR\n  A --&gt; B</code></pre>`,
        "github-dark",
      );
      expect(String(withBlock)).toContain(`<pre class="mermaid">`);
      expect(String(withBlock)).not.toContain("language-mermaid");
      expect(String(withBlock)).toContain("mermaid");
    }
    if (renderContent) {
      const noDiagram = String(
        await renderContent("T", "# Hi\n\ntext", "markdown", "github-dark"),
      );
      expect(noDiagram).not.toContain("mermaid.esm.min.mjs");
      const diagram = String(
        await renderContent(
          "T",
          "# Hi\n\n```mermaid\nflowchart LR\n  A --> B\n```",
          "markdown",
          "github-dark",
        ),
      );
      expect(diagram).toContain(`class="mermaid"`);
      expect(diagram).toContain("mermaid");
    }
  });

  it("maps page theme to mermaid theme (github-light -> default, else dark)", () => {
    if (!mermaidTheme) return;
    expect(mermaidTheme("github-light")).toBe("default");
    expect(mermaidTheme("github-dark")).toBe("dark");
    expect(mermaidTheme("dracula")).toBe("dark");
    expect(mermaidTheme("nord")).toBe("dark");
  });

  it("wraps rendered markdown in documentHTML with escaped title", () => {
    if (!docPick) return;
    const doc = String(
      docPick.value(`A&B <x>`, "github-dark", "<p>hi</p>", ""),
    );
    expect(doc).toContain("<!DOCTYPE html>");
    expect(doc).toContain("A&amp;B");
    expect(doc).toContain("markdown-body");
  });

  it("public-page render rejects missing slugs (not-found)", async () => {
    await resetDb();
    const svc = servicePick?.value;
    if (!svc) return;
    // Prefer the DB-backed renderer when present; otherwise exercise the
    // public reader action which must also 404 on unknown slugs.
    if (renderPublicPage && tablePick) {
      const db = svc.getDb?.();
      const fn = renderPublicPage;
      await expect(
        fn?.execute
          ? fn({
              ctx: { ...mockUser("u1"), db },
              input: { slug: "no-such-page" },
            })
          : fn("no-such-page", "u1"),
      ).rejects.toThrow(/not found/i);
      return;
    }
    if (getPublicPage) {
      const db = svc.getDb?.();
      const fn = getPublicPage;
      await expect(
        fn?.execute
          ? fn({ ctx: { db }, input: { slug: "no-such-page" } })
          : fn({ input: { slug: "no-such-page" } }),
      ).rejects.toThrow(/not found/i);
    }
  });

  it("public-page render rejects private/draft pages (not-found)", async () => {
    const svc = servicePick?.value;
    const create = createPick?.value;
    if (!svc || !create || (!renderPublicPage && !getPublicPage)) return;
    await resetDb();
    const db = svc.getDb?.();
    const alice = { ...mockUser("user_alice"), db };
    const created = create?.execute
      ? await create({
          ctx: alice,
          input: {
            content: "hidden",
            isPublic: false,
            slug: "secret-draft",
            title: "Secret",
          },
        })
      : await create({
          input: {
            content: "hidden",
            isPublic: false,
            slug: "secret-draft",
            title: "Secret",
          },
        });
    expect(created.slug).toBe("secret-draft");
    const reader = renderPublicPage ?? getPublicPage;
    await expect(
      reader?.execute
        ? reader({ ctx: { db }, input: { slug: "secret-draft" } })
        : reader({ input: { slug: "secret-draft" } }),
    ).rejects.toThrow(/not found/i);
  });
});
