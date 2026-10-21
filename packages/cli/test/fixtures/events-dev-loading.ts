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
const service = defineService("dev_loading", { database });

const app = brick({
  services: [service],
  events: {
    listeners: [
      defineListener({
        name: "collector",
        on: "loading",
        run: async () => {
          console.log("delivery started");
          await Bun.sleep(500);
          console.log("delivery finished");
        },
      }),
    ],
  },
  requestLogging: false,
  docs: false,
});

// The commit starts the hub while this entry is still loading.
await emitEvent({ db: database.getDb() }, "loading", {});
await Bun.sleep(10_000);

export default app;
