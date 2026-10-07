# Comments extension

A runnable SQLite extension built from normal Brick APIs. The reusable
`src/extensions/comments/` module exports its table and `registerComments(service)`.
The application adds the table to its database, registers the extension, then
serves the same service through compiled HTTP routes.

From the repository root:

```sh
bun install
bun run --cwd examples/extensions demo
bun run --cwd examples/extensions serve
```

The demo checks create/read/list/update/delete, body trimming, blank-body
rejection and the count action over HTTP and directly in process.
The server uses port 3001 (`PORT` overrides it). SQLite is in memory, so restarting
clears comments. These demo routes are public; authentication and ownership
policies belong in the consuming application's context and resource configuration.

```sh
curl -X POST http://localhost:3001/api/comment \
  -H 'content-type: application/json' \
  -d '{"targetId":"page-1","body":"Hello Brick!"}'
curl 'http://localhost:3001/api/comment?targetId=page-1'
curl 'http://localhost:3001/api/comments/count?targetId=page-1'
```

| Method | Route | Behavior |
| --- | --- | --- |
| POST | `/api/comment` | Create; trim body and reject blank text |
| GET | `/api/comment?targetId=page-1` | List comments for a target |
| GET | `/api/comment/:id` | Read one comment |
| PATCH | `/api/comment/:id` | Update; trim body and reject blank text |
| DELETE | `/api/comment/:id` | Delete one comment |
| GET | `/api/comments/count?targetId=page-1` | Custom TypeBox-validated count action |

To reuse it, import `commentsTable` and `registerComments`, include the table in
`defineDatabase`, apply your schema, and call `registerComments` before building
your server. The module uses SQLite; production applications should manage schema
changes through migrations instead of the demo's `syncSchema` call.
