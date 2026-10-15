import { describe, test, expect } from "bun:test";
import {
  renderContent,
  pageThemeCSS,
  injectMermaid,
  mermaidTheme,
  documentHTML,
} from "../src/api/services/pages/page/render";
describe("page rendering", () => {
  test("renders markdown and raw HTML into full documents", () => {
    const markdown = renderContent(
      "Hello",
      "# Title\n\nBody text.",
      "markdown",
      "github-dark",
    );
    expect(markdown).toContain("<title>Hello</title>");
    expect(markdown).toContain("markdown-body");
    expect(markdown).toContain("Title");
    const raw = "<h1>Raw HTML page</h1><p>custom</p>";
    expect(renderContent("Raw", raw, "html", "github-dark")).toContain(raw);
  });
  test("uses distinct theme CSS and falls back for invalid themes", () => {
    expect(pageThemeCSS("not-a-theme")).toBe(pageThemeCSS("github-dark"));
    expect(pageThemeCSS("")).toBe(pageThemeCSS("github-dark"));
    expect(
      new Set(
        ["github-dark", "github-light", "dracula", "nord"].map(pageThemeCSS),
      ).size,
    ).toBe(4);
    expect(pageThemeCSS("github-light")).toContain("#fff");
    expect(pageThemeCSS("dracula")).toContain("#282a36");
    expect(pageThemeCSS("nord")).toContain("#2e3440");
  });
  test("injects mermaid only for diagrams and maps the theme", () => {
    expect(injectMermaid("<p>no diagrams</p>", "github-dark")).not.toContain(
      "mermaid",
    );
    expect(
      injectMermaid(
        '<pre><code class="language-mermaid">flowchart LR\n A --&gt; B</code></pre>',
        "github-dark",
      ),
    ).toContain('<pre class="mermaid">');
    expect(
      renderContent(
        "T",
        "# Hi\n\n```mermaid\nflowchart LR\n A --> B\n```",
        "markdown",
        "github-dark",
      ),
    ).toContain('class="mermaid"');
    expect(mermaidTheme("github-light")).toBe("default");
    for (const theme of ["github-dark", "dracula", "nord"])
      expect(mermaidTheme(theme)).toBe("dark");
  });
  test("escapes titles in complete HTML documents", () => {
    const doc = documentHTML("A&B <x>", "github-dark", "<p>hi</p>", "");
    expect(doc).toContain("<!DOCTYPE html>");
    expect(doc).toContain("A&amp;B");
    expect(doc).toContain("markdown-body");
  });
});
