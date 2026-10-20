# @brickkit/workflow-inspector

The Workflow SDK's observability UI (runs, step and sleep traces, events,
streams, hooks, replay and cancel), as the Workflows tab of the `brick dev`
dashboard. It is a vendored, modified copy of `@workflow/web`; see `NOTICE`.

```sh
bun add -d @brickkit/workflow-inspector
```

With it installed, `brick dev` serves the inspector for the world your app runs
on (see [Events](https://brickkit.dev/docs/events)) and the dashboard shows it in the
Workflows tab. Nothing else is needed. The production dashboard does not serve
it: the UI can cancel runs and resume hooks.

## Use it from your own server

```ts
import { createInspectorHandler } from "@brickkit/workflow-inspector/handler";

const handle = await createInspectorHandler({
  basename: "/workflows", // where you mount it
  world, // the Workflow SDK world to read
  manifestPath: ".well-known/workflow/v1/manifest.json", // optional
});
// handle(request: Request): Promise<Response>
```

The UI has no sign-in. Put it behind your own, and keep it off the network of
anyone you would not let cancel a run.

## Working on the UI

The source is in `app/` (a React Router app) and builds with
`bun run --filter @brickkit/workflow-inspector build` into `build/`, which
`handler.js` serves. Keep changes to the upstream files small, so that a newer
`@workflow/web` can be merged: compare with the `@workflow/web@5.0.5` tag of
https://github.com/vercel/workflow. The Brick changes are listed in `NOTICE`,
and `test/handler.test.ts` covers them.
