import { describe, expect, it } from "bun:test";

import { createPageTool } from "../src/api/services/pages/page/actions/create";

describe("create_page input", () => {
  const required = { slug: "single-name", title: "Single name" };

  it("accepts only the canonical camelCase fields", () => {
    expect(
      createPageTool.validateInput({
        ...required,
        contentType: "html",
        isPublic: true,
        theme: "nord",
      }).success,
    ).toBe(true);
    expect(createPageTool.validateInput(required).success).toBe(true);
  });

  it("rejects snake_case aliases, including conflicting aliases", () => {
    for (const fields of [
      { content_type: "html" },
      { is_public: true },
      { contentType: "markdown", content_type: "html" },
      { isPublic: false, is_public: true },
    ]) {
      expect(
        createPageTool.validateInput({ ...required, ...fields }).success,
      ).toBe(false);
    }
  });
});
