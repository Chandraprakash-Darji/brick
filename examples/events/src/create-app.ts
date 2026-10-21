import {
  brick,
  defineDatabase,
  defineService,
  syncSchema,
  type DispatchOptions,
  type EventsWorld,
} from "@brickkit/core";
import { crud } from "@brickkit/crud";
import { createCarrier, type Carrier } from "./carrier";
import { setOrdersContext } from "./context";
import { createListeners } from "./listeners";
import { auditLog, notifications, orders, outbox } from "./schema";

export interface OrdersAppOptions {
  /** SQLite file, or `:memory:`. */
  path: string;
  /** Unique per app in one process. */
  serviceName?: string;
  carrier?: Carrier;
  dispatch?: boolean | DispatchOptions;
  /** A Redis world. With it, shipping runs as a durable workflow. */
  world?: EventsWorld;
}

const readOnly = { create: false, update: false, delete: false } as const;

export function createOrdersApp(options: OrdersAppOptions) {
  const carrier = options.carrier ?? createCarrier();
  const database = defineDatabase({
    path: options.path,
    tables: { orders, auditLog, notifications, outbox },
  });
  syncSchema(database.tables, database.getDb());

  const service = defineService(options.serviceName ?? "orders", { database });

  service.resource({ name: "order", table: orders, id: orders.id }).use(
    crud({
      access: "public",
      fields: {
        id: { read: true, filter: ["eq"] },
        customer: { read: true, create: true },
        totalCents: { read: true, create: true },
        status: { read: true, create: true, update: true, filter: ["eq"] },
        internalNote: { create: true, update: true },
      },
    }),
  );

  service
    .resource({ name: "auditEntry", table: auditLog, id: auditLog.id })
    .use(
      crud({
        access: "public",
        operations: readOnly,
        fields: {
          id: { read: true },
          event: { read: true, filter: ["eq"] },
          orderId: { read: true, filter: ["eq"] },
          detail: { read: true },
        },
      }),
    );
  service
    .resource({
      name: "notification",
      table: notifications,
      id: notifications.id,
    })
    .use(
      crud({
        access: "public",
        operations: readOnly,
        fields: {
          id: { read: true },
          kind: { read: true, filter: ["eq"] },
          orderId: { read: true, filter: ["eq"] },
          recipient: { read: true },
        },
      }),
    );

  setOrdersContext({ db: database.getDb(), carrier });

  const app = brick({
    services: [service],
    events: {
      listeners: createListeners(database.getDb() as never, carrier, {
        workflows: options.world !== undefined,
      }),
      dispatch: options.dispatch ?? { intervalMs: 250 },
      ...(options.world ? { world: options.world } : {}),
    },
    requestLogging: false,
    docs: false,
  });
  return { app, database, carrier };
}
