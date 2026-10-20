# @brickkit/workflow-inspector (private)

The Workflow SDK's observability UI (runs, step and sleep traces, events,
streams, hooks, replay and cancel), as the Workflows tab of the `brick dev`
dashboard. It is a vendored, modified copy of `@workflow/web`; see `NOTICE`.

This package is not published. `@brickkit/cli` builds it (`bun run --filter
@brickkit/cli build`) and ships the build as `inspector-dist/`, so `brick dev`
needs nothing installed to show it. The CLI serves the build's `client/` files,
and calls `createFetchHandler` from its `server/index.js` with the app's world.
The production dashboard does not serve it: the UI can cancel runs and resume
hooks.

## Working on the UI

The source is in `app/` (a React Router app) and builds with
`bun run --filter @brickkit/workflow-inspector build` into `build/`. Its colors,
type and radii are the dashboard's own (`packages/cli/dashboard/theme.css`); the
page loads the dashboard's fonts from `/assets/`, so it is only meant to be
shown in a frame of it. Keep changes to the upstream files small, so that a
newer `@workflow/web` can be merged: compare with the `@workflow/web@5.0.5` tag
of https://github.com/vercel/workflow. The Brick changes are listed in `NOTICE`,
and `test/handler.test.ts` covers them.
