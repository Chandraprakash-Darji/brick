import { describe, expect, test } from "bun:test";
import { renderDocsMarkdown } from "../scripts/check-docs-markdown";

describe("documentation markdown", () => {
  test("flattens code tabs without losing examples", () => {
    expect(
      renderDocsMarkdown(`<Tabs items={["Bun", "npm"]}>
<Tab title="Bun">

\`\`\`bash
bun add @brickkit/core
\`\`\`

</Tab>
<Tab title="npm">

\`\`\`bash
npm install @brickkit/core
\`\`\`

</Tab>
</Tabs>`),
    ).toBe(
      "**Bun**\n\n```bash\nbun add @brickkit/core\n```\n\n**npm**\n\n```bash\nnpm install @brickkit/core\n```\n",
    );
  });

  test("renders the rewritten quickstart's package manager tabs", async () => {
    const markdown = renderDocsMarkdown(
      await Bun.file(
        new URL("../content/docs/(brick)/quickstart.mdx", import.meta.url),
      ).text(),
    );
    expect(markdown).toContain("**bun**");
    expect(markdown).toContain("**pnpm**");
    expect(markdown).toContain("**npm**");
    expect(markdown).toContain(
      "pnpm add @brickkit/core @brickkit/crud @brickkit/cli",
    );
    expect(markdown).toContain("POST   /api/page/query");
  });

  test("keeps tutorial steps and card links from the rewritten docs", async () => {
    const markdown = renderDocsMarkdown(
      await Bun.file(
        new URL("../content/docs/(brick)/tutorial.mdx", import.meta.url),
      ).text(),
    );
    expect(markdown).toContain("### Step 1: Project Setup and Dependencies");
    expect(markdown).toContain(
      "[Services & Actions](/docs/services-and-actions)",
    );
    expect(markdown).toContain("[Relational Data Modeling](/docs/relations)");
  });

  test("renders a database table with escaped cells", () => {
    expect(
      renderDocsMarkdown(
        `<DatabaseTable columns={["Column", "Type"]} rows={[["id", "text"], ["choice", "a|b"]]} />`,
      ),
    ).toBe(
      "| Column | Type |\n| --- | --- |\n| id | text |\n| choice | a\\|b |\n",
    );
  });

  test("renders callouts and linked cards without JSX", () => {
    const markdown = renderDocsMarkdown(`<Callout title="Registration">

Import your services.

</Callout>
<Card title="Tools" href="/docs/tools">

Define a tool.

</Card>`);
    expect(markdown).toContain("> Registration\n> \n> Import your services.");
    expect(markdown).toContain("[Tools](/docs/tools)");
    expect(markdown).toContain("Define a tool.");
  });

  test("fails instead of silently losing dynamic or unsupported content", () => {
    expect(() => renderDocsMarkdown("<UnknownWidget />")).toThrow("renderer");
    expect(() => renderDocsMarkdown("{someRuntimeValue}")).toThrow(
      "dynamic expressions",
    );
    expect(() =>
      renderDocsMarkdown(
        '<DatabaseTable columns={["id"]} rows={[["a", "b"]]} />',
      ),
    ).toThrow("match the columns");
  });

  test("preserves code containing JSX and removes MDX imports", () => {
    expect(
      renderDocsMarkdown(
        'import { Widget } from "./widget";\n\n```tsx\n<Widget />\n```',
      ).trim(),
    ).toBe("```tsx\n<Widget />\n```");
  });
});
