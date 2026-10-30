import { t } from "@brickkit/core";

/** The orders event catalog. Each event is recorded as `orders.<name>`. */
export const orderEvents = {
  shipped: t.Object({ id: t.String(), customer: t.String() }),
};
