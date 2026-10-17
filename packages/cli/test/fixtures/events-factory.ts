import { crud } from "@brickkit/crud";
import {
  brick,
  defineDatabase,
  defineListener,
  defineService,
  integer,
  outboxTable,
  sqliteTable,
  syncSchema,
  text,
} from "@brickkit/core";

export function createEventsApp(serviceName: string) {
  const notes = sqliteTable(`${serviceName}_notes`, {
    id: integer("id").primaryKey({ autoIncrement: true }),
    body: text("body").notNull(),
  });
  const outbox = outboxTable("sqlite");
  const database = defineDatabase({ tables: { notes, outbox } });
  syncSchema([notes, outbox], database.getDb());
  const service = defineService(serviceName, { database });
  service.resource({ name: "note", table: notes, id: notes.id }).use(
    crud({
      access: "public",
      fields: {
        id: { read: true },
        body: { read: true, create: true },
      },
    }),
  );
  const received: unknown[] = [];
  const seedPending = () => {
    const now = new Date();
    (database.getDb() as any)
      .insert(outbox)
      .values({
        id: "evt_seeded:collector",
        eventId: "evt_seeded",
        listener: "collector",
        name: "note.create",
        payload: { seeded: true },
        occurredAt: now,
        status: "pending",
        availableAt: now,
      })
      .run();
  };
  const app = brick({
    services: [service],
    events: {
      listeners: [
        defineListener({
          name: "collector",
          on: "note.create",
          run: ({ payload }) => void received.push(payload),
        }),
      ],
      dispatch: { intervalMs: 50 },
    },
    requestLogging: false,
    docs: false,
  });
  return { app, received, seedPending };
}
