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

## Examples catalog

`/examples` lists every `examples/<slug>/` folder that has a
`brick.example.json`; adding one adds the example without touching site code.
`bun run examples:generate` (run by `dev`, `build` and `types:check`) loads each
example's entry in a subprocess and writes the architecture and source files to
`src/generated/`, so the site never runs example code at request time.

```json
{
  "title": "Showcase",
  "description": "One sentence for the card and page header.",
  "tags": ["Starter"],
  "features": ["Shown as a list on the card and detail page"],
  "entry": "src/app.ts",
  "run": ["bun run --cwd examples/showcase serve"],
  "runNote": "Optional note shown under the run commands.",
  "demo": "https://example.com",
  "order": 1
}
```

`demo` is optional; when set, the detail page shows a "Live demo" button and
the card is marked as live.

`entry` is a module that exports a BrickApp (`default` or `app`), a
`buildApp()` factory, or `defineService` services. It must not call `listen()`.
