import { expect, test } from "bun:test";
import { socialMeta } from "../src/lib/social";

test("nested docs use the same absolute PNG URL for OG and X", () => {
  const meta = socialMeta({
    title: "Errors",
    description: "Error reference",
    path: "/docs/reference/errors",
  });
  expect(meta).toContainEqual({
    property: "og:image",
    content: "https://www.brickkit.dev/og/docs/reference/errors.png",
  });
  expect(meta).toContainEqual({
    name: "twitter:image",
    content: "https://www.brickkit.dev/og/docs/reference/errors.png",
  });
  expect(meta).toContainEqual({ property: "og:title", content: "Errors" });
  expect(meta).toContainEqual({
    name: "twitter:card",
    content: "summary_large_image",
  });
});

test("home and trailing-slash index routes point to generated images", () => {
  for (const [path, image] of [
    ["/", "index.png"],
    ["/blog/", "blog.png"],
    ["/examples/", "examples.png"],
    ["/docs/", "docs.png"],
  ]) {
    expect(
      socialMeta({ title: "Brick", description: "", path }),
    ).toContainEqual({
      property: "og:image",
      content: `https://www.brickkit.dev/og/${image}`,
    });
  }
});
