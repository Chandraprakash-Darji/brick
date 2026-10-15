# Comments extension

The comments factory composes an Effect-native CRUD contract and handlers with
an explicit SQLite database dependency. Its write hooks trim bodies, reject
blank input and check that the parent page exists. The application supplies a
scoped database Layer that creates and seeds the example schema.

Run `bun run --cwd examples/extensions demo` to exercise the actual HTTP routes,
write hooks, parent checks, list/count filters, updates and deletion. Run
`bun run --cwd examples/extensions test` for validation checks.

Start a server with `bun run --cwd examples/extensions serve`. Operations follow
REST routes with JSON payloads: `POST /api/pageComment/query` (list),
`GET /api/pageComment/:id` (read), `POST /api/pageComment` (create),
`PATCH /api/pageComment/:id` (update), `DELETE /api/pageComment/:id`
(delete). For example, create accepts `{"targetId":"page-1","body":"Hello"}`
and read takes the id in the path.

A reusable extension is a contract plus a factory of Effect handlers. Dependencies
belong in Layers. This example uses one comments table and explicitly public
access; an application with private content must supply its authorization policy.
