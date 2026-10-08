export function mermaidTheme(theme: string): string {
  return theme === "github-light" ? "default" : "dark";
}

const mermaidScript = `
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
mermaid.initialize({ startOnLoad: true, theme: "%s", securityLevel: "strict" });
</script>`;

/** Rewrite mermaid fences to <pre class="mermaid"> + loader (no-op if none). */
export function injectMermaid(htmlContent: string, theme: string): string {
  if (!htmlContent.includes('<pre><code class="language-mermaid">'))
    return htmlContent;
  const replaced = htmlContent.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    '<pre class="mermaid">$1</pre>',
  );
  return replaced + mermaidScript.replace("%s", mermaidTheme(theme));
}
