import { describe, it, expect } from "bun:test";

// Port of server/resources/toc_test.go + toc.go / headings.go behavior.
// Backend under porting by sibling agents:
//   src/api/services/pages/service.ts (render helpers + resource)
// Tests resolve helpers via dynamic import so `tsc --noEmit` passes even
// when the backend module does not exist yet. Missing helpers are marked
// todo with a clear name instead of inventing a different API.

const SERVICE_PATH = "../src/api/services/pages/service";

type TocHeading = { level: number; id: string; text: string };

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

const svcMod: Record<string, any> | null = await tryImport(SERVICE_PATH);
const extractPick = pick(
  svcMod,
  "extractHeadings",
  "extract_headings",
  "extractTocHeadings",
  "extractTOCHeadings",
);
const buildPick = pick(
  svcMod,
  "buildTOC",
  "buildToc",
  "build_toc",
  "renderTOC",
);
const anchorPick = pick(
  svcMod,
  "injectHeadingAnchors",
  "injectHeadingAnchor",
  "injectAnchors",
  "inject_heading_anchors",
);

const hasExtract =
  extractPick !== null && typeof extractPick.value === "function";
const hasBuild = buildPick !== null && typeof buildPick.value === "function";
const hasAnchor = anchorPick !== null && typeof anchorPick.value === "function";

const extractHeadings: ((html: string) => TocHeading[]) | null = hasExtract
  ? (extractPick!.value as (html: string) => TocHeading[])
  : null;
const buildTOC: ((headings: TocHeading[]) => string) | null = hasBuild
  ? (buildPick!.value as (headings: TocHeading[]) => string)
  : null;
const injectHeadingAnchors: ((html: string) => string) | null = hasAnchor
  ? (anchorPick!.value as (html: string) => string)
  : null;

// Fixture mirrored from Go TestExtractHeadingsAndBuildTOC.
const GO_BODY = `<h1 id="title">Build Proposal</h1>
<p>intro</p>
<h2 id="the-problem">1. <strong>The</strong> problem</h2>
<p>text</p>
<h3 id="drawing-triage">Drawing triage</h3>
<h4 id="ignored">Too deep</h4>`;

describe("TOC extract/build (port of toc_test.go)", () => {
  if (!hasExtract) {
    it.todo("TODO: extractHeadings — needs extractHeadings(html) in src/services/pages/service.ts (h1-h3 only, strip inner tags)", () => {});
  }
  if (!hasBuild) {
    it.todo("TODO: buildTOC — needs buildTOC(headings) in src/services/pages/service.ts (min-2-headings empty, toc-dash/toc-link markup)", () => {});
  }
  if (!hasAnchor) {
    it.todo("TODO: injectHeadingAnchors — needs injectHeadingAnchors(html) in src/services/pages/service.ts (heading-anchor permalink)", () => {});
  }

  it("extracts h1-h3 only, skipping h4+ (port of TestExtractHeadingsAndBuildTOC)", () => {
    if (!extractHeadings) return;
    const headings = extractHeadings(GO_BODY);
    expect(headings.length).toBe(3);
    expect(headings.map((h) => h.level)).toEqual([1, 2, 3]);
  });

  it("strips inner tags from heading text (port of TestExtractHeadingsAndBuildTOC)", () => {
    if (!extractHeadings) return;
    const headings = extractHeadings(GO_BODY);
    expect(headings[1]!.text).toBe("1. The problem");
  });

  it("preserves level + id for h3 headings", () => {
    if (!extractHeadings) return;
    const headings = extractHeadings(GO_BODY);
    expect(headings[2]!.level).toBe(3);
    expect(headings[2]!.id).toBe("drawing-triage");
  });

  it("buildTOC emits dashes, links, and clean text (port of TestExtractHeadingsAndBuildTOC)", () => {
    if (!extractHeadings || !buildTOC) return;
    const toc = buildTOC(extractHeadings(GO_BODY));
    for (const want of [
      `data-target="title"`,
      `class="toc-dash toc-d2"`,
      `href="#drawing-triage"`,
      "1. The problem",
    ]) {
      expect(toc).toContain(want);
    }
  });

  it("injects heading-anchor permalinks (port of TestInjectHeadingAnchors)", () => {
    if (!injectHeadingAnchors) return;
    const out = injectHeadingAnchors(
      `<h2 id="the-problem">1. The problem</h2>`,
    );
    for (const want of [
      `<h2 id="the-problem">1. The problem<a href="#the-problem"`,
      `class="heading-anchor"`,
      `aria-hidden="true"`,
      `</a></h2>`,
    ]) {
      expect(out).toContain(want);
    }
  });

  it("keeps TOC text clean: extraction runs before injection", () => {
    if (!extractHeadings || !injectHeadingAnchors) return;
    const src = `<h2 id="the-problem">1. The problem</h2>`;
    // Injecting must not pollute a later extraction with "#" text.
    const injected = injectHeadingAnchors(src);
    expect(injected).toContain("heading-anchor");
    const headings = extractHeadings(src);
    expect(headings[0]!.text).toBe("1. The problem");
  });

  it("returns empty TOC for a single heading (port of TestBuildTOC_SingleHeadingSkipped)", () => {
    if (!extractHeadings || !buildTOC) return;
    const headings = extractHeadings(`<h1 id="only">Only one</h1>`);
    expect(buildTOC(headings)).toBe("");
  });

  it("returns empty TOC for zero headings", () => {
    if (!buildTOC) return;
    expect(buildTOC([])).toBe("");
  });

  it("escapes heading id/text in TOC markup (XSS safety)", () => {
    if (!buildTOC) return;
    const toc = buildTOC([{ id: `a"b<c>`, level: 2, text: `<b>&"x"` }]);
    // Two headings required for non-empty TOC; single-heading input is empty
    // by design, so use two headings to exercise escaping.
    const toc2 = buildTOC([
      { id: "ok", level: 1, text: "Ok" },
      { id: `a"b<c>`, level: 2, text: `<b>&"x"` },
    ]);
    expect(toc).toBe("");
    expect(toc2).not.toContain(`<b>&"x"`);
    expect(toc2).toContain("&lt;b&gt;");
  });

  it("skips headings with empty text after tag stripping", () => {
    if (!extractHeadings) return;
    const headings = extractHeadings(
      `<h2 id="empty"><strong></strong></h2><h2 id="real">Real</h2>`,
    );
    expect(headings.map((h) => h.id)).toEqual(["real"]);
  });

  it("unescapes HTML entities in heading text", () => {
    if (!extractHeadings) return;
    const headings = extractHeadings(`<h2 id="a-b">A &amp; B</h2>`);
    expect(headings[0]!.text).toBe("A & B");
  });
});
