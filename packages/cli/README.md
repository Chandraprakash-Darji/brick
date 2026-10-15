# @brickkit/cli

The `brick` command for Effect-native Brick applications: dev server,
production start, bundling, OpenAPI and client-contract generation, and a Vite
plugin that keeps the browser contract in sync with the backend.

You need Bun 1.2 or later.

```sh
bun add -d @brickkit/cli
```

## Commands

Every command except `dev` and `start` takes a required `<entry>`: a module
whose default export is the value returned by `Brick.app(...)`. The entry must
not start a listener itself.

```sh
brick dev [entry] [--port 4000]
brick start [entry] [--port 4000]
brick build <entry> [--outdir dist/brick] [--port <number>]
brick gen openapi <entry> [--output openapi.json]
brick gen client <entry> [--output _brick/contract.ts]
brick info <entry>
```

`dev` and `start` resolve the port from `--port`, then `PORT`, then 4000.
`brick build` bundles the app into a Bun server and writes `brick-ir.json`
(version 2, target `effect-http-api`) describing services and routes.
`brick info` prints the same architecture JSON without starting anything.

```ts
// src/app.ts
import { Brick } from "@brickkit/core";
import { Layer } from "effect";
import { usersService } from "./services/users";

export default Brick.app({ services: [usersService], layer: Layer.empty });
```

## Typed browser client with Vite

Add `brickClient` before your framework plugins:

```ts
// vite.config.ts
import { brickClient } from "@brickkit/cli/vite";

export default defineConfig({
  plugins: [
    brickClient({ entry: "./src/api/app.ts" }),
    // TanStack Start, React, or other framework plugins
  ],
});
```

Vite writes `_brick/contract.ts` before the frontend loads and before
production builds, and regenerates it when backend files change. Unchanged
output is not rewritten. Add `_brick/` to `.gitignore`; change its location
with the `output` option.

The generated module exports the API definition and the client factories:

```ts
import { api, createClient } from "../_brick/contract";

const { client } = createClient(api, { baseUrl: "http://localhost:4000" });
await client.users.getUser({ payload: { id: "usr_42" } });
```

For TanStack Start or another embedded server, import the app from
`virtual:brick-app` in server code and forward requests to `app.fetch(request)`.
Add `/// <reference types="@brickkit/cli/vite/client" />` to your Vite
environment declarations. See `examples/pages` for a complete integration.

Generation evaluates the app entry, so anything it needs must be available at
development and build time. Keep startup jobs and connection-opening work in
layers or your server bootstrap, not at module scope. The Vite integration
requires Vite 8.

## Without Vite

```sh
brick gen client src/app.ts --output frontend/src/contract.ts
```

The command evaluates the entry, creates parent directories, and leaves an
unchanged file untouched. Run it before your frontend's dev server, build, and
type check; a package script keeps this simple:

```json
{ "scripts": { "gen:client": "brick gen client src/app.ts" } }
```

`generateNativeClientContract(app, options)` exposes the generator for other
tooling.

Source: <https://github.com/Chandraprakash-Darji/brick>.
