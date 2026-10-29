# Website showcase

The website imports these files directly as highlighted source. The tiny users
service uses a seeded in-memory Map so it runs without a database.

From the repository root, invoke the action with `bun run --cwd examples/showcase call`,
or serve it with `bun run --cwd examples/showcase serve`.
The HTTP route is `POST /api/users/get-user` on port 3000.
