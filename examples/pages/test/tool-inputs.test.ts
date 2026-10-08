import { describe, expect, it } from "bun:test";

import {
  pageMcpActions,
  createPageTool,
  editPageTool,
} from "../src/api/services/pages/mcp";
import { prepareTestDatabase } from "./database";

const inputs: Record<string, Record<string, unknown>> = {
  create_page: { slug: "page", title: "Page" },
  delete_page: { id: "page" },
  echo: { message: "Hello" },
  edit_page: { contentType: "html", id: "page", isPublic: false },
  get_page: { id: "page" },
  get_page_content: { id: "page" },
  get_public_page: { slug: "page" },
  list_pages: {},
  render_page: { id: "page" },
  upload_content: { content: "Body", id: "page" },
  whoami: {},
};

describe("MCP tool inputs", () => {
  for (const action of pageMcpActions) {
    it(`${action.name} accepts canonical fields and rejects unknown fields`, () => {
      expect(action.validateInput(inputs[action.name]).success).toBe(true);
      expect(
        action.validateInput({ ...inputs[action.name], unexpected: true })
          .success,
      ).toBe(false);
      expect(
        Object.keys(action.config.input?.properties ?? {}).some((key) =>
          key.includes("_"),
        ),
      ).toBe(false);
    });
  }

  it("edit_page rejects snake_case aliases and conflicting duplicate values", () => {
    for (const fields of [
      { content_type: "html" },
      { is_public: true },
      { contentType: "markdown", content_type: "html" },
      { isPublic: false, is_public: true },
    ]) {
      expect(
        editPageTool.validateInput({ id: "page", ...fields }).success,
      ).toBe(false);
    }
  });

  it("edit_page preserves omitted fields and applies an explicit false", async () => {
    await prepareTestDatabase();
    const ctx = { user: { id: "tool-input-user" } };
    const page = await createPageTool({
      ctx,
      input: {
        contentType: "html",
        isPublic: true,
        slug: "edit-single-name",
        title: "Original",
      },
    });
    const edited = await editPageTool({
      ctx,
      input: { id: page.id, isPublic: false },
    });
    expect(edited.isPublic).toBe(false);
    expect(edited.contentType).toBe("html");
    expect(edited.title).toBe("Original");
  });
});
