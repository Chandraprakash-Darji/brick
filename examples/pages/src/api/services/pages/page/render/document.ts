import { markdownToHtml } from "./markdown";
import { injectMermaid } from "./mermaid";
import { escapeHtml, escapeAttr } from "./text";
import { pageThemeCSS, tocCSS, headingCSS, tocScript } from "./themes";
import { extractHtmlHeadings, buildTOC, injectHeadingAnchors } from "./toc";

export function documentHTML(
  title: string,
  theme: string,
  body: string,
  toc: string,
): string {
  const css = pageThemeCSS(theme);
  const script = toc !== "" ? tocScript : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${css}
${tocCSS}
${headingCSS}</style>
</head>
<body class="markdown-body theme-${escapeAttr(theme)}">
${toc}
<div class="page-content mx-auto max-w-3xl px-6 py-12" style="margin-inline: auto; max-width:48rem; padding-inline: 1.5rem; padding-block: 3rem;">
${body}
</div>
${script}
<script>(function(){if(!location.hash)return;var el=document.getElementById(location.hash.slice(1));if(el)el.scrollIntoView({behavior:'smooth',block:'start'})})();</script>
</body>
</html>`;
}

/**
 * Convert raw content (markdown or html) to a full HTML document.
 * Used by the MCP render_page action without a second DB query.
 */
export function renderContent(
  title: string,
  content: string,
  contentType: string,
  theme: string,
): string {
  const resolvedTheme = theme || "github-dark";
  if (contentType === "html") {
    return content;
  }
  const rendered = markdownToHtml(content);
  const toc = buildTOC(extractHtmlHeadings(rendered));
  const body = injectMermaid(injectHeadingAnchors(rendered), resolvedTheme);
  return documentHTML(title, resolvedTheme, body, toc);
}

/**
 * Render a DB page row to a full HTML document (used by GET /p/:slug).
 */
export function renderPageDocument(page: {
  title: string;
  content: string;
  contentType: string;
  theme: string;
}): string {
  return renderContent(page.title, page.content, page.contentType, page.theme);
}
