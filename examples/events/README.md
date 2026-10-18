# Events example

An orders service whose writes emit events. Every generated `create`, `update`
and `delete` on `order` records an event in the same transaction as the row, and
three listeners react to it after the commit:

| Listener   | Listens for    | What it does                                                          |
| ---------- | -------------- | --------------------------------------------------------------------- |
| `audit`    | `order.*`      | Writes one `audit_log` row per event, describing what changed.        |
| `receipt`  | `order.create` | Writes a `receipt` notification.                                      |
| `shipping` | `order.update` | When `status` becomes `shipped`, books a carrier and notifies. Flaky. |

The carrier is a stand-in API that can be told to fail, so the `shipping`
listener shows retries and the `dead` state. Every listener writes its row under
`deliveryId`, so a second run of the same delivery changes nothing.

`internalNote` can be written but not read, so it never appears in an event.

## Run it

From the repository root:

```sh
bun run --cwd examples/events test    # 10 tests, in memory
bun run --cwd examples/events demo    # a walkthrough with a failing carrier
bun run --cwd examples/events dev     # brick dev on port 4000, reloads on changes
bun run --cwd examples/events start   # brick start
```

The database is `.data/orders.sqlite`. Set `DB_PATH` to move it. Set
`CARRIER_FAILURES=2` to make the carrier fail twice before it answers, which
delays a shipped notification by the retry backoff (1s, then 2s).

```sh
curl -s -X POST localhost:4000/api/order -H 'content-type: application/json' \
  -d '{"customer":"ada@example.com","totalCents":4200}'
curl -s -X POST localhost:4000/api/notification/query -H 'content-type: application/json' -d '{}'
```

SQLite allows one process per database file, so this example delivers events in
the same process that serves requests. With PostgreSQL, run the API with
`events: { dispatch: false }` and deliver from other processes.
