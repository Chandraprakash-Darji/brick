/**
 * Docs content handling — port of app/src/content.config.ts +
 * app/src/content/docs/*.md (Astro content collection).
 *
 * Markdown sources live in ../content/docs/*.md (verbatim copies of the
 * Astro originals) and are bundled via Vite `?raw` imports. Frontmatter is
 * parsed here; bodies are rendered with `marked` at the route level.
 */

import { marked } from "marked";

import gettingStartedRaw from "../content/docs/00-getting-started.md?raw";
import writingContentRaw from "../content/docs/01-writing-content.md?raw";
import publishingRaw from "../content/docs/02-publishing.md?raw";
import agentIntegrationRaw from "../content/docs/03-agent-integration.md?raw";

// Docs render with GitHub Flavored Markdown + single-newline breaks, matching
// the old Astro content rendering ("All standard GFM features are supported").
marked.setOptions({ breaks: true, gfm: true });

export interface DocEntry {
  slug: string;
  title: string;
  description?: string;
  body: string;
}

/**
 * Strip one layer of surrounding single/double YAML quotes, keeping the
 * naive line-based frontmatter parser below honest
 * (`title: "Getting Started"` -> `Getting Started`).
 */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Sanitization note: DOMPurify is NOT a dependency (package.json is owned by
 * the infra agent — ask them to add `dompurify` + `@types/dompurify` if this
 * ever changes). Until then this is an identity function, documented here
 * rather than silently omitted. Risk is currently low: the only inputs are
 * first-party `.md` files bundled at build time via `?raw` imports, and
 * `marked` output for those is rendered with dangerouslySetInnerHTML at
 * docs/$slug.tsx. If user-controlled markdown is ever rendered through
 * renderMarkdown, sanitize with DOMPurify.sanitize() here first.
 */
function sanitizeHtml(html: string): string {
  return html;
}

function parseDoc(slug: string, raw: string): DocEntry {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    // Mirrors the old Astro collection schema (zod `title: z.string()`,
    // required): a doc without frontmatter fails fast instead of silently
    // rendering under a slug-derived title.
    throw new Error(`Doc "${slug}" is missing frontmatter with a title.`);
  }
  const body = match[2];
  let title: string | undefined;
  let description: string | undefined;
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = unquote(line.slice(idx + 1).trim());
    if (key === "title") title = value;
    if (key === "description") description = value;
  }
  if (!title) {
    throw new Error(`Doc "${slug}" is missing required frontmatter "title".`);
  }
  return { body, description, slug, title };
}

export const docs: DocEntry[] = [
  parseDoc("00-getting-started", gettingStartedRaw),
  parseDoc("01-writing-content", writingContentRaw),
  parseDoc("02-publishing", publishingRaw),
  parseDoc("03-agent-integration", agentIntegrationRaw),
].sort((a, b) => a.slug.localeCompare(b.slug));

export function getDoc(slug: string): DocEntry | undefined {
  return docs.find((doc) => doc.slug === slug);
}

function slugifyHeading(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, dec: string) =>
      String.fromCharCode(Number(dec)),
    );
}

/**
 * Inject `id` slugs + hover-revealed `#` hash anchors into h1–h6.
 * (Port of the portfolio prose convention: CSS reveals `.anchor` on
 * hover/focus; `scroll-margin-top` + `scroll-padding-top` handle offset.)
 */
function addHeadingAnchors(html: string): string {
  const seen = new Map<string, number>();
  return html.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g,
    (_match, level: string, inner: string) => {
      const text = decodeEntities(inner.replace(/<[^>]*>/g, "")).trim();
      const base = slugifyHeading(text);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const slug = count === 0 ? base : `${base}-${count}`;
      return `<h${level} id="${slug}">${inner}<a class="anchor" href="#${slug}" aria-label="#">#</a></h${level}>`;
    },
  );
}

export function renderMarkdown(markdown: string): string {
  // marked's types allow an async extension to return Promise<string>; with
  // the stock parser this is always a string.
  const html = marked.parse(markdown) as string;
  return sanitizeHtml(addHeadingAnchors(html));
}
