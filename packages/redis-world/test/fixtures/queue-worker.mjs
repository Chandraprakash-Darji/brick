import { getQueueTopicPrefix } from "@workflow/world";
import { createWorld } from "../../dist/index.js";
const config = JSON.parse(process.env.QUEUE_CONFIG);
const queue = createWorld(config);
queue.registerHandler(getQueueTopicPrefix("workflow"), async (request) => {
  process.send({ headers: [...request.headers] });
  await new Promise(() => {});
});
await queue.start();
