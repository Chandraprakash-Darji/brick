import { escapeHtml, escapeAttr, unescapeHtml } from "./text";

export interface RenderedHeading {
  level: number;
  id: string;
  text: string;
}

/** Pull h1-h3 headings (with auto IDs) out of rendered HTML, in order. */
export function extractHtmlHeadings(htmlBody: string): RenderedHeading[] {
  const re = /<h([1-3]) id="([^"]+)"[^>]*>([\s\S]*?)<\/h[1-3]>/g;
  const headings: RenderedHeading[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(htmlBody)) !== null) {
    const text = unescapeHtml(m[3].replace(/<[^>]+>/g, "")).trim();
    if (!text) continue;
    headings.push({ id: m[2], level: Number(m[1]), text });
  }
  return headings;
}

/** TOC markup, or "" when fewer than two headings (no contents rail). */
export function buildTOC(headings: RenderedHeading[]): string {
  if (headings.length < 2) return "";
  let dashes = "";
  let links = "";
  for (const h of headings) {
    dashes += `<span class="toc-dash toc-d${h.level}" data-target="${escapeAttr(h.id)}"></span>`;
    const indent = 12 + (h.level - 1) * 12;
    links += `<li><a href="#${escapeAttr(h.id)}" class="toc-link" data-target="${escapeAttr(h.id)}" style="padding-left:${indent}px">${escapeHtml(h.text)}</a></li>`;
  }
  return `<nav class="toc" id="toc" aria-label="Table of contents">\n<div class="toc-trigger">${dashes}</div>\n<div class="toc-popover"><ul>${links}</ul></div>\n</nav>`;
}

/** Append "#" permalink anchors to headings (rehype-autolink style). */
export function injectHeadingAnchors(htmlBody: string): string {
  return htmlBody.replace(
    /(<h[1-6] id="([^"]+)"[^>]*>)([\s\S]*?)(<\/h[1-6]>)/g,
    (_m, open: string, id: string, inner: string, close: string) =>
      `${open}${inner}<a href="#${escapeAttr(id)}" class="heading-anchor" aria-hidden="true" tabindex="-1"></a>${close}`,
  );
}
