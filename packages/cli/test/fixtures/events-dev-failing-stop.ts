import {
  brick,
  defineDatabase,
  defineListener,
  defineService,
  emitEvent,
  outboxTable,
  syncSchema,
} from "@brickkit/core";

const outbox = outboxTable("sqlite");
const database = defineDatabase({ tables: { outbox } });
syncSchema([outbox], database.getDb());
const service = defineService("dev_failing_stop", { database });

const app = brick({
  services: [service],
  events: {
    listeners: [
      defineListener({ name: "collector", on: "failing", run: () => {} }),
    ],
  },
  requestLogging: false,
  docs: false,
});

// The commit starts the hub while this entry is still loading, as in
// events-dev-loading, and then the hub cannot stop.
await emitEvent({ db: database.getDb() }, "failing", {});
app.events!.stop = async () => {
  throw new Error("close failed");
};
console.log("entry loading");
await Bun.sleep(10_000);

export default app;
