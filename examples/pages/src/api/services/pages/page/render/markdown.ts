import { escapeHtml, escapeAttr, slugifyHeading } from "./text";
import { extractHtmlHeadings } from "./toc";

// Headings from markdown source, or rendered HTML (Go toc.go parity).
export function extractHeadings(markdown: string) {
  // Go parity: extractHeadings operates on rendered HTML (toc.go). When handed
  // rendered HTML, delegate to the HTML extractor (h1-h3, strip inner tags,
  // unescape entities); otherwise fall back to the markdown-source scan.
  if (/<h[1-6][\s>]/.test(markdown)) {
    return extractHtmlHeadings(markdown);
  }
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  const headings: Array<{ level: number; id: string; text: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(markdown)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");
    headings.push({ id, level, text });
  }

  return headings;
}

function sanitizeUrl(url: string): string {
  const cleaned = url.replace(/["'<>\s]/g, "");
  if (/^(javascript|data|vbscript):/i.test(cleaned)) return "#";
  return escapeAttr(cleaned);
}

function renderInline(raw: string): string {
  let s = escapeHtml(raw);
  s = s.replace(/`([^`\n]+?)`/g, (_m, code: string) => `<code>${code}</code>`);
  s = s.replace(
    /!\[([^\]]*?)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_m, alt: string, url: string, title: string | undefined) =>
      `<img src="${sanitizeUrl(url)}" alt="${escapeAttr(alt)}"${title ? ` title="${escapeAttr(title)}"` : ""}>`,
  );
  s = s.replace(
    /\[([^\]]+?)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_m, text: string, url: string, title: string | undefined) =>
      `<a href="${sanitizeUrl(url)}"${title ? ` title="${escapeAttr(title)}"` : ""}>${text}</a>`,
  );
  s = s.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+?)__/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
  s = s.replace(/~~([^~\n]+?)~~/g, "<del>$1</del>");
  s = s.replace(/(?<!["'=])https?:\/\/[^\s<)"']+/g, (u: string) => {
    const trimmed = u.replace(/[.,;:!?)]+$/g, "");
    const trail = u.slice(trimmed.length);
    return `<a href="${escapeAttr(trimmed)}">${trimmed}</a>${trail}`;
  });
  return s;
}

function isTableDelimiter(line: string): boolean {
  const cells = line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|");
  if (cells.length === 0) return false;
  return cells.every(
    (c) => /^[\s:~-]*-{1,}[\s:~-]*$/.test(c) && c.includes("-"),
  );
}

function renderTableRow(
  line: string,
  aligns: string[],
  header: boolean,
): string {
  const cells = line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
  const tag = header ? "th" : "td";
  const tds = cells.map((c, i) => {
    const align =
      aligns[i] && aligns[i] !== "left"
        ? ` style="text-align:${aligns[i]}"`
        : "";
    return `<${tag}${align}>${renderInline(c)}</${tag}>`;
  });
  return `<tr>${tds.join("")}</tr>`;
}

/**
 * Minimal GFM markdown -> HTML: fenced code (incl. mermaid), ATX headings
 * with auto IDs, tables, task lists, bullet/ordered lists, blockquotes,
 * strikethrough, hr, paragraphs. Raw block-HTML lines pass through.
 */
export function markdownToHtml(src: string): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let inFence = false;
  let fenceLang = "";
  let fenceBuf: string[] = [];
  let listTag = "";
  let quoteBuf: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      out.push(`<p>${renderInline(para.join("\n"))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (listTag) {
      out.push(`</${listTag}>`);
      listTag = "";
    }
  };
  const flushQuote = () => {
    if (quoteBuf.length > 0) {
      out.push(
        `<blockquote><p>${renderInline(quoteBuf.join("\n"))}</p></blockquote>`,
      );
      quoteBuf = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fenceOpen = line.match(/^```(\w*)\s*$/);
    if (inFence) {
      if (/^```\s*$/.test(line)) {
        const cls = fenceLang
          ? ` class="language-${escapeAttr(fenceLang)}"`
          : "";
        out.push(
          `<pre><code${cls}>${escapeHtml(fenceBuf.join("\n"))}</code></pre>`,
        );
        inFence = false;
        fenceLang = "";
        fenceBuf = [];
      } else {
        fenceBuf.push(line);
      }
      continue;
    }
    if (fenceOpen) {
      flushPara();
      closeList();
      flushQuote();
      inFence = true;
      fenceLang = fenceOpen[1] ?? "";
      continue;
    }

    // GFM table: header row + delimiter row.
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableDelimiter(lines[i + 1])
    ) {
      flushPara();
      closeList();
      flushQuote();
      const aligns = lines[i + 1]
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => {
          const t = c.trim();
          if (/^:.*:$/.test(t)) return "center";
          if (t.startsWith(":")) return "left";
          if (t.endsWith(":")) return "right";
          return "left";
        });
      const rows: string[] = [renderTableRow(line, aligns, true)];
      i += 2;
      while (
        i < lines.length &&
        lines[i].includes("|") &&
        lines[i].trim() !== ""
      ) {
        rows.push(renderTableRow(lines[i], aligns, false));
        i++;
      }
      i--;
      out.push(`<table>${rows.join("")}</table>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flushPara();
      closeList();
      flushQuote();
      const level = heading[1].length;
      const rawText = heading[2].trim();
      const id = slugifyHeading(rawText.replace(/[`*_~[\]()!]/g, ""));
      out.push(
        `<h${level} id="${escapeAttr(id)}">${renderInline(rawText)}</h${level}>`,
      );
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      closeList();
      flushQuote();
      out.push("<hr>");
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushPara();
      closeList();
      quoteBuf.push(quote[1]);
      continue;
    }
    flushQuote();

    const task = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      flushPara();
      if (listTag !== "ul") {
        closeList();
        out.push("<ul>");
        listTag = "ul";
      }
      const checked = task[1].toLowerCase() === "x" ? " checked" : "";
      out.push(
        `<li><input type="checkbox" disabled${checked}> ${renderInline(task[2])}</li>`,
      );
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      flushPara();
      if (listTag !== "ul") {
        closeList();
        out.push("<ul>");
        listTag = "ul";
      }
      out.push(`<li>${renderInline(bullet[1])}</li>`);
      continue;
    }
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushPara();
      if (listTag !== "ol") {
        closeList();
        out.push("<ol>");
        listTag = "ol";
      }
      out.push(`<li>${renderInline(ordered[1])}</li>`);
      continue;
    }
    closeList();

    if (/^\s*$/.test(line)) {
      flushPara();
      continue;
    }

    // Raw block HTML passes through (owner-trusted, Go parity).
    if (
      /^\s*<(div|pre|table|details|section|article|aside|figure|blockquote|hr|h[1-6]|ul|ol|li|p|img|a|span|code|nav)[\s>]/.test(
        line,
      )
    ) {
      flushPara();
      out.push(line);
      continue;
    }

    para.push(line.trim());
  }

  if (inFence) {
    const cls = fenceLang ? ` class="language-${escapeAttr(fenceLang)}"` : "";
    out.push(
      `<pre><code${cls}>${escapeHtml(fenceBuf.join("\n"))}</code></pre>`,
    );
  }
  flushPara();
  closeList();
  flushQuote();
  return out.join("\n");
}
