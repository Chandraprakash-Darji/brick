import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToMarkdown } from "fumadocs-core/server";
import { DatabaseTable } from "../src/components/database-table";

test("renders accessible HTML with constraints and a foreign-key anchor", () => {
  const html = renderToStaticMarkup(
    <DatabaseTable
      name="comments"
      fields={[
        {
          name: "id",
          type: "text",
          description: "Identifier",
          isPrimaryKey: true,
          isUnique: true,
        },
        {
          name: "article_id",
          type: "text",
          description: "Parent",
          isForeignKey: true,
          references: { table: "articles", field: "id" },
          isOptional: true,
        },
        { name: "body", type: "text", description: "<script>" },
      ]}
    />,
  );
  expect(html).toContain('id="database-table-comments"');
  expect(html).toContain('aria-label="comments database schema"');
  expect(html).toContain('scope="col">Field</th>');
  expect(html).toContain('scope="row"');
  expect(html).toContain('href="#database-table-articles"');
  expect(html).toContain(">PK</span>");
  expect(html).toContain(">Unique</span>");
  expect(html).toContain(">Optional</span>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<a id=");
});

test("renders a Markdown table with references and falsy defaults", async () => {
  const markdown = await renderToMarkdown(
    <DatabaseTable
      name="settings"
      fields={[
        {
          name: "id",
          type: "text",
          description: "Identifier",
          isPrimaryKey: true,
        },
        {
          name: "parent",
          type: "text",
          description: "Parent",
          references: { table: "settings", field: "id" },
          isUnique: true,
          isOptional: true,
        },
        {
          name: "count",
          type: "integer",
          description: "Count",
          defaultValue: 0,
        },
        {
          name: "enabled",
          type: "boolean",
          description: "Enabled",
          defaultValue: false,
        },
        { name: "note", type: "text", description: "Note", defaultValue: null },
      ]}
    />,
  );
  expect(markdown).toContain("#### Table Name: `settings`");
  expect(markdown).toContain("Table Name: `settings`");
  expect(markdown.replace(/ +/g, " ")).toContain(
    "| Field | Type | Description |",
  );
  expect(markdown).toContain("Identifier PK");
  expect(markdown).toContain("[FK: settings.id](#table-name-settings)");
  expect(markdown).toContain("Unique");
  expect(markdown).toContain("Optional");
  expect(markdown).toContain("Default: 0");
  expect(markdown).toContain("Default: false");
  expect(markdown).toContain("Default: null");
  expect(markdown).not.toContain("<DatabaseTable");
});

test("escapes Markdown cell delimiters", async () => {
  const markdown = await renderToMarkdown(
    <DatabaseTable
      name="notes"
      fields={[{ name: "body", type: "text", description: "One | two\nthree" }]}
    />,
  );
  expect(markdown).toContain("One \\| two");
  expect(markdown).not.toContain("Default:");
});
