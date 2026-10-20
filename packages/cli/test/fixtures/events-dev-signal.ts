import {
  brick,
  defineDatabase,
  defineListener,
  defineService,
  outboxTable,
  syncSchema,
} from "@brickkit/core";

const outbox = outboxTable("sqlite");
const database = defineDatabase({ tables: { outbox } });
syncSchema([outbox], database.getDb());
const service = defineService("dev_signal", { database });
const now = new Date();
(database.getDb() as any)
  .insert(outbox)
  .values({
    id: "evt_signal:collector",
    eventId: "evt_signal",
    listener: "collector",
    name: "signal",
    payload: {},
    occurredAt: now,
    status: "pending",
    availableAt: now,
  })
  .run();

export default brick({
  services: [service],
  events: {
    listeners: [
      defineListener({
        name: "collector",
        on: "signal",
        run: async () => {
          console.log(`delivery started ${process.pid}`);
          if (process.env.BRICK_TEST_DELIVERY_MS === "never")
            await new Promise<void>(() => {});
          else await Bun.sleep(Number(process.env.BRICK_TEST_DELIVERY_MS));
          console.log("delivery finished");
        },
      }),
    ],
  },
  requestLogging: false,
  docs: false,
});
