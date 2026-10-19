import { brick, defineListener, defineService, t } from "@brickkit/core";
import { hello } from "./hello";

/** A stand-in world: it counts how often it is closed, and starts nothing. */
export const world = {
  closed: 0,
  createRunId: () => "unused",
  close: async () => void world.closed++,
};

const service = defineService("greetings");
service.action({
  name: "ping",
  input: t.Object({}),
  execute: () => ({ ok: true }),
});

export default brick({
  services: [service],
  events: {
    world,
    workflows: { root: new URL("..", import.meta.url).pathname },
    listeners: [defineListener({ name: "greet", on: "x.y", workflow: hello })],
  },
  requestLogging: false,
  docs: false,
});
