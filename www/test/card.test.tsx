import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import { Card } from "../src/components/card";

describe("Card component", () => {
  test("renders full link card with focus ring, hover styling, and arrow when href is provided", () => {
    const html = renderToStaticMarkup(
      <Card
        title="Quickstart"
        description="Get started in minutes"
        href="/docs/quickstart"
      />,
    );

    // Whole card is a single <a>
    expect(html).toStartWith('<a href="/docs/quickstart"');
    expect(html).toContain('data-card="true"');

    // Visible focus ring
    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain("focus-visible:ring-ring");

    // Hover styling
    expect(html).toContain("hover:border-foreground/30");
    expect(html).toContain("hover:bg-accent/80");

    // Arrow icon
    expect(html).toContain("lucide-arrow-up-right");

    // No nested <a> or <button>
    const anchorMatches = html.match(/<a[\s>]/g) || [];
    expect(anchorMatches.length).toBe(1);
    expect(html).not.toContain("<button");
  });

  test("renders static card without hover styles, arrow, or pointer cursor when href is omitted", () => {
    const html = renderToStaticMarkup(
      <Card title="Static Note" description="Informational card only" />,
    );

    // Renders static container, not <a>
    expect(html).toStartWith("<div");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href=");

    // No hover styles
    expect(html).not.toContain("hover:");

    // No arrow icon
    expect(html).not.toContain("lucide-arrow");

    // No cursor pointer
    expect(html).not.toContain("cursor-pointer");
  });

  test("fails if a Card has hover styling but no href", () => {
    expect(() =>
      renderToStaticMarkup(
        <Card title="Invalid" className="hover:bg-accent" />,
      ),
    ).toThrow("Card has hover or pointer styling but no href.");

    expect(() =>
      renderToStaticMarkup(
        <Card title="Invalid" className="hover:border-foreground" />,
      ),
    ).toThrow("Card has hover or pointer styling but no href.");

    expect(() =>
      renderToStaticMarkup(<Card title="Invalid" className="cursor-pointer" />),
    ).toThrow("Card has hover or pointer styling but no href.");
  });

  test("fails if a Card has arrow styling but no href", () => {
    expect(() =>
      renderToStaticMarkup(<Card title="Invalid" arrow={true} />),
    ).toThrow("Card has arrow styling but no href.");
  });

  test("audits that every Card in documentation has an href", async () => {
    const root = new URL("../content/docs/", import.meta.url);
    const glob = new Bun.Glob("**/*.mdx");
    let cardCount = 0;

    for await (const path of glob.scan(fileURLToPath(root))) {
      const content = await Bun.file(new URL(path, root)).text();
      const cardRegex = /<Card\b([^>]*)\/?>/g;
      let match;
      while ((match = cardRegex.exec(content)) !== null) {
        const props = match[1];
        cardCount++;
        expect(props).toContain("href=");
        expect(props).not.toContain("hover:");
        expect(props).not.toContain("cursor-pointer");
      }
    }

    expect(cardCount).toBeGreaterThan(0);
  });
});
