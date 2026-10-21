// A process whose deliveries never finish, for the second-signal test.
import { finishDeliveriesOnSignal } from "../../src/runner";

finishDeliveriesOnSignal({
  stop: () => {
    console.log("stopping");
    return new Promise<void>(() => {});
  },
});
setInterval(() => {}, 1000);
console.log("ready");
