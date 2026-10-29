import { port } from "@brickkit/core";
import type { Carrier } from "./carrier";

/**
 * What the orders service needs from the app. `brick({ deps })` provides the
 * values; actions read `ctx.deps`, and the steps of a workflow, which cannot
 * close over the app that started them, read `useDeps(ordersDeps)`.
 */
export const ordersDeps = {
  db: port<any>(),
  carrier: port<Carrier>(),
};
