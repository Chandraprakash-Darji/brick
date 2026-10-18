import { createWorld } from "@brickkit/redis-world";
import { createCarrier } from "./carrier";
import { createOrdersApp } from "./create-app";

// With REDIS_URL, shipping runs as a durable workflow on a Redis world. Without it,
// the same listener name set is delivered by plain handlers and nothing needs Redis.
const world = process.env.REDIS_URL
  ? createWorld({ redis: process.env.REDIS_URL, keyPrefix: "orders:" })
  : undefined;

const { app } = createOrdersApp({
  path: process.env.DB_PATH ?? ".data/orders.sqlite",
  carrier: createCarrier({
    failures: Number(process.env.CARRIER_FAILURES ?? 0),
  }),
  world,
});

export default app;
