---
name: brick
description: Build and modify TypeScript backends with Brick on Bun, including services, actions, resources, CRUD, typed clients, and MCP tools. Use when a project uses @brickkit/core, @brickkit/crud, or @brickkit/cli.
---

# Brick projects

Read the project's package scripts and existing service definitions before changing code. Use the installed Brick version as the API reference.

## Find documentation

Fetch `https://brick.rega.run/llms.txt` and follow the relevant markdown links. Use `https://brick.rega.run/llms-full.txt` when you need the complete reference. Each docs page also has a `.md` URL, and accepts `Accept: text/markdown`.

Use `/docs/quickstart.md` for a runnable starter and `/docs/tutorial.md` for an end-to-end REST API. For existing projects, fetch the relevant guides:

- `/docs/services-and-actions.md`, `/docs/context.md`, and `/docs/validation-and-errors.md` for actions and execution context.
- `/docs/resources.md`, `/docs/access-control.md`, `/docs/hooks.md`, and `/docs/relations.md` for CRUD and database changes.
- `/docs/typed-client.md` for browser clients and `/docs/tools-and-mcp.md` for MCP tools.
- `/docs/reference/cheatsheet.md` for symbols and `/docs/brick-cli/info.md` for architecture exports.

If the hosted docs differ from the installed version, inspect the package types and source.

## Follow Brick's definitions

- Define actions with `Brick.action(name, path, { input, output, errors })` using Effect Schema (not TypeBox). The call returns a handler factory: handlers receive decoded input and return an `Effect`.
- Model domain errors as `Schema.TaggedError` classes annotated with `{ httpApiStatus }` (e.g. 400, 401, 403, 404, 409). Status codes map to HTTP responses automatically; undeclared defects are redacted to `"Internal server error"`.
- Group actions with `Brick.service(name, { actions })` and compose with `Brick.app({ services, layer, routes?, docs?, client?, transports? })`. Supply dependencies as Effect `Layer`s and require them in handlers with `yield*`. Lifecycle is `await app.ready()`, `app.fetch(request)`, `await app.dispose()`.
- For generated CRUD use `crudContract({ name, path, table, id, fields, errors })` plus `.implement({ store: sqliteStore(table, Db) | postgresStore(table, Db), access, hooks?, scrub? })`. Generated REST routes are `POST base/query` (list), `POST base/find-one`, `GET base/:id` (get), `POST base` (create), `PATCH base/:id` (update), `DELETE base/:id` (delete), `POST base/count`, `POST base/exists`. Access is deny-by-default: use `"public"` or `{ authorize, scope }`; never row-scope `create` (enforce ownership in `beforeCreate` instead).
- For custom HTTP methods or URL params use `Brick.endpoint(name, method, path, { input: { params?, query?, payload?, headers? }, output, errors })`.
- Expose MCP with `Brick.app({ transports: { mcp: { name, version, path } } })`. Mark agent-callable actions with `mcp: true` and tool behavior flags (`readOnly`, `destructive`, `idempotent`, `openWorld`).
- Call the API from browsers only through the generated contract module: `const { client, ready, dispose } = createClient(Api, { baseUrl })` (synchronous), then `client.service["actionName"]({ payload })` for bodies or `{ params: { id } }` for `:id` routes. Never import server-only modules (database, layers, handlers) in browser code.

## Inspect the application

A running Brick app exposes its registered architecture at `GET /_brick/services`. For an offline export, run `bunx brick info <entry>` with the project's app entry file. The CLI loads definitions before exporting mounted routes and resource access policies. Service options are included, so review configuration values before sharing the JSON.

An app can expose MCP at its configured transports path (commonly `/mcp`). Read its tool definitions and auth layer before calling tools. The documentation site does not provide a hosted MCP server.

Run the project's type checks and relevant tests after edits. Follow its scripts for schema migrations and contract generation.
