import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { tools } from "../src/api/contract";
const decode = Schema.decodeUnknownExit(
  tools.create_page.tool.parametersSchema,
  { onExcessProperty: "error" },
);
describe("native create_page schema", () => {
  test("accepts canonical fields and rejects aliases, malformed slugs, and empty titles", () => {
    expect(
      decode({
        slug: "single-name",
        title: "Page",
        contentType: "html",
        isPublic: false,
      })._tag,
    ).toBe("Success");
    for (const fields of [
      { content_type: "html" },
      { is_public: true },
      { title: "" },
      { slug: "bad slug" },
    ])
      expect(
        decode({ slug: "single-name", title: "Page", ...fields })._tag,
      ).toBe("Failure");
  });
});
