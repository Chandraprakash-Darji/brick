# Website example

The website imports these files as highlighted source. The users service uses a
seeded Map and needs no database. Effect Schema defines its input, output and
NotFound error. The same handler runs locally and through native HTTP routes.

Run `bun run --cwd examples/showcase call`, or start the server with
`bun run --cwd examples/showcase serve`.

```sh
curl http://localhost:3000/api/users/getUser -H 'content-type: application/json' -d '{"id":"usr_42"}'
```
