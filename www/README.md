# brick-ts www

Docs site for brick-ts, built with TanStack Start + Fumadocs.

Run development server:

```bash
bun install
bun run dev
```

Build and preview:

```bash
bun run build
bun run start
```

Content lives in `content/docs` (fumadocs-mdx).

## Markdown for agents

`/llms.txt` links to every page. `/llms-full.txt` concatenates pages in sidebar
order. `/docs/<slug>.md` and `Accept: text/markdown` on `/docs/<slug>` return the
same content. Docs HTML is served at runtime so Vercel's static file serving does
not bypass content negotiation. Both negotiated representations vary on `Accept`.

`bun run docs:check` renders every docs page and runs markdown renderer tests.
The production build runs this check too. Dynamic MDX expressions and components
without renderable content fail the check instead of disappearing from exports.
Code tabs flatten to labeled code blocks, callouts become blockquotes, and cards
become links. `DatabaseTable` exports accept static JSON `columns` and `rows`, for
example `columns={["Column", "Type"]} rows={[["id", "text"]]}`. Prefer native
markdown tables for new documentation.

With the site running, verify every exported URL and content negotiation:

```bash
bun run docs:http-check http://localhost:3000
```

The installable Brick agent skill lives in `../skills/brick/SKILL.md`. The
`for-ai-agents` docs page includes project instructions and MCP setup.
