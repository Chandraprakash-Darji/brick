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
bun run --cwd examples/events test    # in memory, no services needed
bun run --cwd examples/events demo    # a walkthrough with a failing carrier
bun run --cwd examples/events dev     # brick dev on port 4000, reloads on changes
bun run --cwd examples/events start   # brick start
```

The database is `.data/orders.sqlite`. Set `DB_PATH` to move it. Set
`CARRIER_FAILURES=2` to make the carrier fail twice before it answers.

```sh
curl -s -X POST localhost:4000/api/order -H 'content-type: application/json' \
  -d '{"customer":"ada@example.com","totalCents":4200}'
curl -s -X POST localhost:4000/api/notification/query -H 'content-type: application/json' -d '{}'
```

## Shipping as a workflow

With `REDIS_URL` set, the `shipping` handler is replaced by `fulfilment`, a
workflow (`src/workflows/fulfil-order.ts`) that the Workflow SDK runs on a Redis
world. It books the carrier in a step, waits a second with a durable timer, and
notifies the customer in a second step.

```sh
docker run -d -p 6379:6379 redis:7
REDIS_URL=redis://localhost:6379 bun run --cwd examples/events dev
REDIS_URL=redis://localhost:6379 bun run --cwd examples/events test   # the workflow tests run on both worlds
```

`brick dev` and `brick start` build the workflow bundle into
`.well-known/workflow/v1` before events start. What to look at:

- With `CARRIER_FAILURES=2`, the booking step fails twice and the SDK retries it
  after 100 ms. The delivery is not retried, and the carrier is booked once.
- Stop the server with `kill -9` while an order is shipping and start it again.
  The run resumes and the notification still arrives.
- Delivering the same event again (reset its outbox row to `pending`) does not
  start a second run.
- `test/webhook.test.ts` runs a workflow that waits on `createWebhook`: a request
  to its URL on the Brick server resumes it. The example lists `@workflow/utils`
  so the SDK finds the port the server listens on.

- `bunx brick dev src/app.ts` (without `--no-dashboard`) serves the dashboard on
  9400; its Workflows tab is the SDK's inspector (it comes with the CLI) showing each
  `fulfilOrder` run and its trace.

SQLite allows one process per database file, so this example delivers events in
the same process that serves requests. With PostgreSQL, run the API with
`events: { dispatch: false }` and deliver from other processes.
