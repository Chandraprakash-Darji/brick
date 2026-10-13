import assert from "node:assert/strict";
import { renderDocsMarkdown } from "./check-docs-markdown";

const base = process.argv[2] ?? "http://localhost:3000";
async function get(path: string, accept?: string) {
  const response = await fetch(new URL(path, base), {
    headers: accept ? { Accept: accept } : {},
    redirect: "manual",
  });
  assert.equal(response.status, 200, `${path}: expected a direct 200 response`);
  return { response, text: await response.text() };
}
function checkMarkdown(response: Response, text: string, index = false) {
  assert.match(
    response.headers.get("Content-Type") ?? "",
    index ? /^text\/(markdown|plain)/ : /^text\/markdown/,
  );
  assert.ok(text.trim().startsWith("# "), "Expected a markdown title");
  renderDocsMarkdown(text);
}
const index = await get("/llms.txt");
checkMarkdown(index.response, index.text, true);
assert.match(index.text, /^# Brick\n\n> /);
assert.ok(
  !index.text.includes("localhost"),
  "The published index must use canonical URLs",
);
const links = [...index.text.matchAll(/^- \[([^\]]+)\]\(([^)]+)\): .+/gm)];
assert.ok(links.length > 0, "Expected documentation links with descriptions");
const full = await get("/llms-full.txt");
checkMarkdown(full.response, full.text, true);
let lastPosition = -1;
for (const [, title, url] of links) {
  const path = new URL(url).pathname;
  const page = await get(path);
  checkMarkdown(page.response, page.text);
  const docsPath = path === "/docs/index.md" ? "/docs" : path.slice(0, -3);
  const negotiated = await get(docsPath, "text/markdown");
  checkMarkdown(negotiated.response, negotiated.text);
  assert.equal(
    negotiated.text,
    page.text,
    `${path}: markdown representations differ`,
  );
  assert.match(negotiated.response.headers.get("Vary") ?? "", /Accept/i);
  const position = full.text.indexOf(`# ${title}\n`, lastPosition + 1);
  assert.ok(
    position > lastPosition,
    `${title}: full docs must follow index order`,
  );
  lastPosition = position;
}
for (const accept of [
  "text/html",
  "*/*",
  "text/html;q=1, text/markdown;q=0.5",
]) {
  const html = await get("/docs/quickstart", accept);
  assert.match(html.response.headers.get("Content-Type") ?? "", /^text\/html/);
  assert.match(html.response.headers.get("Vary") ?? "", /Accept/i);
}
const missing = await fetch(new URL("/docs/missing-page", base), {
  headers: { Accept: "text/markdown" },
});
assert.equal(missing.status, 404);
console.log(
  `Verified ${links.length} markdown pages, full-doc order, negotiation, and 404s.`,
);
