import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { tools } from "../src/api/contract";
const inputs: Record<string, unknown> = {
  create_page: { slug: "page", title: "Page" },
  delete_page: { id: "page" },
  echo: { message: "hi" },
  edit_page: { id: "page", isPublic: false },
  get_page: { id: "page" },
  get_page_content: { id: "page" },
  get_public_page: { slug: "page" },
  list_pages: {},
  render_page: { id: "page" },
  upload_content: { id: "page", content: "body" },
  whoami: {},
};
describe("native tool contracts", () => {
  for (const tool of Object.values(tools))
    test(`${tool.name} exposes one schema for HTTP and MCP`, () => {
      const decode = Schema.decodeUnknownExit(tool.tool.parametersSchema, {
        onExcessProperty: "error",
      });
      expect(decode(inputs[tool.name])._tag).toBe("Success");
      expect(decode({ unexpected: true })._tag).toBe("Failure");
      expect(tool.mcp).toBe(true);
    });
});
