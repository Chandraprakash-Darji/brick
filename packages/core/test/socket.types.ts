import { defineService, t } from "../src";
import { createBrickClient, type BrickClientSocket } from "../src/client";

const service = defineService("chat", {
  context: () => ({ user: { id: "user" } }),
});
service.socket({
  name: "live",
  input: { say: t.String(), count: t.Number() },
  output: { message: t.Object({ text: t.String() }) },
  handlers: {
    say({ input, ctx, socket }) {
      const text: string = input;
      const id: string = ctx.user.id;
      socket.send("message", { text: text + id });
      // @ts-expect-error Output payloads are checked.
      socket.send("message", { text: 42 });
      // @ts-expect-error Direction is checked.
      socket.send("say", "hello");
    },
    count({ input }) {
      const number: number = input;
      void number;
    },
  },
});
service.socket({
  name: "missing",
  input: { say: t.String() },
  output: {},
  // @ts-expect-error Every input event requires a handler.
  handlers: {},
});

declare const contract: {
  chat: {
    live: BrickClientSocket<
      { say: string; count: number },
      { message: { text: string } }
    >;
  };
};
const live = createBrickClient({
  baseUrl: "https://example.test",
  contract,
}).chat.live.connect();
live.send("say", "hello");
live.send("count", 42);
live.on("message", (payload) => {
  const text: string = payload.text;
  void text;
});
// @ts-expect-error Unknown event.
live.send("unknown", "hello");
// @ts-expect-error Wrong payload.
live.send("say", 42);
// @ts-expect-error Reversed direction.
live.on("say", () => {});
declare const union: "say" | "count";
// @ts-expect-error An uncorrelated union event/payload must not compile.
live.send(union, "hello");
