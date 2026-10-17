# Brick dev dashboard (UI)

The React app that `brick dev` and the Vite plugin serve. The source lives here
and builds into `../dashboard-dist`, which git ignores and the package ships.

```sh
bun run --filter @brickkit/cli build   # bundles this app, then the CLI
```

The server reads `dashboard-dist` from disk on every request, so after a rebuild
a browser reload shows the new UI without restarting `brick dev`.

## Layout

- `main.tsx`, `app.tsx`: entry and the app root (routing, shortcuts, theme).
- `state.ts`: the event-stream reducer, hash routing (`#/requests/<traceId>`),
  and the theme, clock, and sidebar hooks.
- `format.ts`: pure helpers for stats, bucketing, and span nesting. They have
  unit tests in `../test/dashboard-format.test.ts`.
- `graph.ts`: builds the service graph from the architecture and recent
  traces, and lays it out in columns (`../test/dashboard-graph.test.ts`).
- `filters.ts`: the request log's filters, counts, and link and query-string
  handling, used for live requests and matching the server's history queries
  (`../test/dashboard-filters.test.ts`).
- `history.ts`: the hooks that read `/api/history/*` for the stored requests,
  their counts, volume, and summary (`../test/dashboard-history.test.ts`).
- `shell.tsx`: the sidebar and top bar.
- `views/`: Requests, Overview, APIs, Docs, Errors, Reloads.
- `components/`: `Panel`, `Metric`, `TimelineStrip`, `FacetPanel`,
  `RequestDrawer`, `Waterfall`, `ServiceGraphPanel`, `ApiReference`.
- `components/docs/`: the Docs tab: `DocsTree`, `DocsSearch`, `DocsPageView` and
  `Toc`, the MDX component set and runner (`mdx-components.tsx`), and the hooks
  that read `/api/docs/*` (`use-docs.ts`).
- `components/ui/`: shadcn components (style `base-nova`, built on Base UI).

## Design system

Follows Efferd's Dashboard 9. Tokens live in `styles.css` for both themes.

- **Look:** monochrome and dense. Color is kept for status: green for good
  trends, red for failures and negative trends.
- **Type:** Geist and Geist Mono. 12px metadata, 14px body and navigation,
  24px metric values and page headings.
- **Shape:** cards and tables are square with a 1px border and no shadow.
  Controls use `--radius` (10px). Cards carry a plus mark on each corner.
- **Layout:** a 48px icon rail that opens to show labels (the top bar button
  or ⌘B/Ctrl+B; it overlays the page on narrow screens), a 56px top bar, 24px
  page padding, and 16px gaps between cards.
- **Cards:** a small icon and label, a large value, a trend line, and a block
  sparkline on the right (`SparkBars`).
- **Charts:** stacked rectangular blocks (`block-bars` in `styles.css`) over
  dashed gridlines, in grayscale with red for server errors.
- **Span colors:** request blue, action violet, service call amber, SQL teal,
  other gray (`--span-*` in `styles.css`), used by the waterfall, its legend,
  and the service graph's edges. Red and green stay reserved for status.
- **Service graph:** boxed nodes on a dotted canvas, left to right: clients,
  services, then databases. A node shows its name, what it holds (a service's
  actions and tools, a database's engine and tables), and live calls and
  average duration. Hover a node to follow its calls. The canvas shrinks to
  fit, down to 60%, then scrolls.
- **Logs:** `ctx.logger` in `@brickkit/core` (`src/logger.ts`) records a line as a
  `log` event on the active span when `installTracing` has switched capture on
  (a `Symbol.for("brickkit.logs.capture")` flag on `globalThis`, shared by name
  because the app and the dev server may hold separate copies of core), and
  prints otherwise. `installTracing` also wraps `console.log/info/warn/error/debug`
  (`captureConsole` in `src/dev-telemetry.ts`), which hands each call to core's
  `recordActive` (published as `Symbol.for("brickkit.logs.record")`) and prints
  only when no span took it; it runs under `brick dev` and under `brick start`
  with a `dashboard` option, and nowhere else. Events
  already reach the store with their span, and with stored history, so nothing
  else carries them. `logs.ts` reads them out and holds the search: a small
  query language (`parseLogQuery`: words, `"phrases"`, `-negation`, and
  `level:`/`route:`/`action:`/`method:`/`trace:`) with match marking. The view
  (`views/logs.tsx`) lists them newest first, 150 rows at a time, with level
  counts, a since selector, and a pause that freezes the list; the request
  drawer lists one request's. A span keeps 100 lines (OpenTelemetry's 128 events
  include exceptions) and counts the rest in `brick.logs.dropped`.
- **Production mode:** the same app, served by `startDevDashboard` with
  `mode: "production"` for `brick start` (`src/production-dashboard.ts`, from the
  app's `dashboard` option). The server then answers only what
  `isMonitoringRoute` lists (the shell and assets, `/api/state`, `/api/events`,
  `/api/history*`), adds security headers, and puts `mode` in the snapshot, which
  hides the APIs and Docs tabs and the restart button and shows a Production
  badge. `src/dashboard-access.ts` checks each request against `auth` (tokens
  compared in constant time, and the app's `authorize` with a five-second limit)
  before anything but `/_health`. Spans reach the store in-process, with no
  worker or ingest endpoint.
- **Request log:** laid out like a hosting dashboard's logs. Four cards (requests,
  error rate, median, slowest 5%) follow the range and filters. A timeline strip
  across the top (drag to zoom), a Custom picker beside the ranges (from and to,
  to the second; it sets the same window a drag does, and looks in history
  whatever range is picked), filters on the left with a count beside each
  value, a dense table in the middle, and the selected request in a drawer on
  the right (an overlay on narrow screens; Esc closes it). Live and stored
  requests share it; the time range chooses between them.
- **API reference:** Fumadocs OpenAPI (`fumadocs-openapi`, with `@fumadocs/base-ui`
  standing in for the `fumadocs-ui` it expects) renders the app's OpenAPI
  documents from `/api/openapi`, entirely in the browser: its `OpenAPIPage` takes
  a plain document as its `payload`. `api-operations.ts` lists the operations by
  tag for a sidebar of our own (`components/api-reference.tsx`), and the open one
  is in the address, `#/apis/<document>/<method>/<path>`. It loads on demand
  (`React.lazy`), which is why the build splits chunks and styles; the server
  serves plain file names, so chunks are not put in a folder. Code is
  highlighted by `lib/shiki.ts`, a handful of languages, which `vite.config.ts`
  puts in place of the Shiki bundle Fumadocs would load (every language and
  theme). The view stays mounted once opened, with its scroll position kept.
  Try in Playground goes through the server's `/api/proxy?url=…`, which forwards
  only to the app, and each response is followed by the app's trace of it
  (`components/api-trace.tsx`, matched by the response's `x-trace-id`).
- **Docs:** the app's `documentation` folder, from `src/dev-docs.ts`. The server
  builds the page tree with fumadocs-core, compiles each page's MDX to a function
  body with Shiki highlighting, and watches the folder; the dashboard runs the
  body with `new Function`, using `@fumadocs/base-ui`'s components mapped onto the
  dashboard's tokens (`css/shadcn.css` in `styles.css`) plus the project's own. The
  view loads on demand, like the API reference. Docs links are routes
  (`#/docs/guide/setup#install`), so heading links scroll instead of navigating.
  The project's components are bundled by the server (Bun.build under Bun, Vite
  under Node) with React left external; the page shell's import map points
  `react` at `dashboard-dist/react.js`, which `scripts/build-dashboard.ts` writes
  to hand over the dashboard's own copy. The root `.gitignore` has `docs/`, so a
  folder of this name needs an exception there.
- **Controls:** outline buttons, compact segmented toggles, and a `kbd` hint on
  the search button. Hover states stay quiet.

## Adding shadcn components

`bunx shadcn add` does not recognise this folder as a project, because there is
no `package.json` beside `components.json`, and it tries to scaffold a Next app.
Fetch the component from the registry instead:

```sh
curl https://ui.shadcn.com/r/styles/base-nova/<name>.json
```

Write each file's `content` to `components/ui/`, replace `from "cn"` with
`from "@/lib/utils"`, and run `oxfmt` on it.
