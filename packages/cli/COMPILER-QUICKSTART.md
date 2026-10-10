# Use the Brick compiler in your app

Brick compiles services and actions defined with `@brickkit/core` into HTTP
handlers. Use it for the API part of a Bun app, including an app with a separate
frontend. It does not compile arbitrary application code or frontend components.

## Install

For the Elysia v2 AOT beta, install both packages after the beta release is published:

```sh
bun add @brickkit/core@beta @brickkit/cli@beta
```

## Define your API

Create `src/app.ts` and default-export your Brick app without calling `.listen()`:

```ts
import { defineService, t } from "@brickkit/core";
import { brick } from "@brickkit/cli";

export const greetings = defineService("greetings");

greetings.action({
  name: "hello",
  method: "GET",
  input: t.Object({ name: t.String() }),
  output: t.Object({ message: t.String() }),
  execute: ({ input }) => ({ message: `Hello, ${input.name}!` }),
});

export default brick({ services: [greetings] });
```

For an existing app, use the same entry you pass to `brick gen client`. The build
uses that app's selected services, prefix, docs, endpoints, and hooks.

## Develop, build and run

Keep server startup in `src/server.ts`:

```ts
import app from "./app";

app.listen(4000);
```

```sh
bun --watch src/server.ts
```

For production, stop the development server, then build and run:

```sh
bunx brick build src/app.ts --outdir dist/brick --port 4000
bun dist/brick/server.js
```

Test the action:

```sh
curl 'http://localhost:4000/api/greetings/hello?name=Sam'
# {"message":"Hello, Sam!"}
```

The beta build enables Elysia AOT by default. Add `--no-aot` to keep Elysia's
runtime compiler. Both builds still use Brick's generated action handlers.
Set `PORT=8080 bun dist/brick/server.js` to override the port at deployment.
Deploy `server.js` with Bun and any database files, assets and environment
variables your app needs.

## Use an existing server

To embed Brick in a Bun server instead of running the generated standalone server:

```ts
import api from "./app";

Bun.serve({
  port: 4000,
  fetch: (request) => api.fetch(request),
});
```

Forward requests for your Brick routes to `api.fetch(request)` in your existing
server's request handler. Direct `brick()` calls compile Brick handlers at startup;
Elysia's build-time AOT runs through `brick build`.

Keep migrations, seeding and `.listen()` out of the app entry. Builds
evaluate that module, and AOT also dry-runs the app. Finalize services and routes
before handling requests; rebuild after changing definitions.

See [the compiler reference](COMPILER.md) for programmatic builds and artifact details.
