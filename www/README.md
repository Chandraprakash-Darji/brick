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
become links. `DatabaseTable` exports render the same schema fields as the HTML component.

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

## Document database schemas

Add a `### Schema` section to every guide that creates or requires a table.
`DatabaseTable` is registered globally for MDX. Use SQL column names and match
constraints to the Drizzle declaration. Set `isOptional` for nullable columns;
label `$defaultFn` values as application defaults.

```mdx
### Schema

export const exampleFields = [
  {
    name: "id",
    type: "text",
    description: "Row identifier.",
    isPrimaryKey: true,
  },
  {
    name: "parent_id",
    type: "text",
    description: "Parent row.",
    isForeignKey: true,
    references: { table: "parents", field: "id" },
  },
  {
    name: "enabled",
    type: "boolean",
    description: "Whether enabled.",
    isOptional: true,
    defaultValue: false,
  },
];

<DatabaseTable name="examples" fields={exampleFields} />
```

Fields support `isPrimaryKey`, `isUnique`, `isForeignKey`, `references`,
`isOptional`, and `defaultValue`. Foreign-key badges link to the referenced
`DatabaseTable` on the same page. Include that table on the page when you use
`references`. Describe logical relationships in prose when the schema does
not declare a SQL foreign key.

The component renders a Markdown table in `/docs/*.md` and `/llms-full.txt`
through the docs Markdown renderer. Field arrays must use static values so
the renderer can read them at build time without running JavaScript.

Run the component checks with `bun test test` from `www`.

## Analytics (Umami)

Page views and custom events go to our self-hosted Umami instance on Vercel.
The tracker script is added in `src/routes/__root.tsx` via TanStack Start's
`head()` `scripts` field, mirroring `Chandraprakash-Darji/portfolio`
(`src/lib/analytics.ts` + `data-umami-event` attributes).

Set these in the www Vercel project (**Production only**, so localhost and
preview builds send nothing):

```bash
VITE_UMAMI_URL=https://umami.example.com
VITE_UMAMI_WEBSITE_ID=your-website-id
```

The script is only included when both `VITE_UMAMI_URL` and
`VITE_UMAMI_WEBSITE_ID` are set. `data-domains` is the production hostname
(`brick.rega.run`), so forks don't send events.

TanStack Router client-side navigation is tracked automatically — Umami
watches the History API, so don't call `umami.track()` for page views (that
would double-count).

Custom events (`src/lib/analytics.ts` `trackEvent` + `data-umami-event`):

- `copy-install-command` (install command copy button)
- `ask-ai-open`, `ask-ai-message` (AI chat)
- `docs-copy-markdown`, `docs-edit-github` (docs page actions)
- `example-open` (examples catalog cards)
- `search-open` (docs search trigger)
- `github-click` (outbound GitHub links)

Umami is cookieless. The footer notes this.

Optional ad-blocker proxy: set `VITE_UMAMI_URL` and `VITE_UMAMI_HOST_URL` to the
first-party `/stats` base (e.g. `https://brick.rega.run/stats`) so `src` stays
first-party (`/stats/script.js`) and `data-host-url` sends to `/stats/api/send`
on our domain. Proxy `/stats/script.js` → the Umami instance's `/script.js`
and forward `/stats/api/send` → the Umami instance's `/api/send` (`/api/collect`
is the legacy endpoint).
