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
    expect(markdown).toContain("pnpm add @brickkit/core @brickkit/cli effect");
    expect(markdown).toContain("/api/users/getUser");
  });

  test("keeps native tutorial steps and guide links", async () => {
    const markdown = renderDocsMarkdown(
      await Bun.file(
        new URL("../content/docs/(brick)/tutorial.mdx", import.meta.url),
      ).text(),
    );
    expect(markdown).toContain("## Run a service");
    expect(markdown).toContain(
      "[services and actions](/docs/services-and-actions)",
    );
    expect(markdown).toContain("[relational data](/docs/relations)");
  });

  test("renders exported schema fields with constraints and escaped cells", () => {
    const markdown = renderDocsMarkdown(`export const fields = [
      { name: "id", type: "text", description: "a|b", isPrimaryKey: true, isUnique: true },
      { name: "parent_id", type: "text", description: "Parent", references: { table: "parents", field: "id" }, isOptional: true },
      { name: "count", type: "integer", description: "Count", defaultValue: 0 },
      { name: "enabled", type: "boolean", description: "Enabled", defaultValue: false },
    ];

<DatabaseTable name="children" fields={fields} />`);
    expect(markdown).toContain("#### Table Name: `children`");
    expect(markdown.replace(/ +/g, " ")).toContain(
      "| Field | Type | Description |",
    );
    expect(markdown).toContain("a\\|b PK Unique");
    expect(markdown).toContain(
      "[FK: parents.id](#table-name-parents) Optional",
    );
    expect(markdown).toContain("Default: 0");
    expect(markdown).toContain("Default: false");
    expect(markdown).not.toContain("export const");
  });

  test("renders inline schema fields without evaluating JavaScript", () => {
    const markdown = renderDocsMarkdown(
      '<DatabaseTable name="counts" fields={[{ name: "count", type: "integer", description: "Count", defaultValue: -1 }]} />',
    );
    expect(markdown).toContain("Default: -1");
    expect(() =>
      renderDocsMarkdown('<DatabaseTable name="bad" fields={getFields()} />'),
    ).toThrow("static field values");
    expect(() =>
      renderDocsMarkdown('<DatabaseTable name="bad" fields={missingFields} />'),
    ).toThrow("static field values");
    expect(() =>
      renderDocsMarkdown(
        '<DatabaseTable name="bad" fields={[{ name: "id" }]} />',
      ),
    ).toThrow();
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
    expect(() => renderDocsMarkdown('<DatabaseTable name="bad" />')).toThrow(
      "fields array",
    );
  });

  test("preserves code containing JSX and removes MDX imports", () => {
    expect(
      renderDocsMarkdown(
        'import { Widget } from "./widget";\n\n```tsx\n<Widget />\n```',
      ).trim(),
    ).toBe("```tsx\n<Widget />\n```");
  });
});
