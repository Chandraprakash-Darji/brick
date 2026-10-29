import { resolve } from "node:path";
import {
  brick,
  defineService,
  getCompiledCheck,
  t,
  type BrickSocketSender,
  type SocketPayloads,
} from "@brickkit/core";
import { createChatStore, chatMessage, type ChatMessage } from "./store";

const output = {
  connected: t.Object({ id: t.String(), name: t.String() }),
  presence: t.Object({ count: t.Integer({ minimum: 0 }) }),
  history: t.Object({ messages: t.Array(chatMessage), done: t.Boolean() }),
  message: chatMessage,
};
const sessionInput = getCompiledCheck(
  t.Object(
    { fingerprint: t.String({ pattern: "^[a-f0-9]{32}$" }) },
    { additionalProperties: false },
  ),
);
const allowedOrigins = ["http://localhost:5178"];

export function createChatApp(
  path = process.env.BRICK_CHAT_DB ?? resolve(".brick/chat.sqlite"),
) {
  const store = createChatStore(path);
  const clients = new Set<BrickSocketSender<SocketPayloads<typeof output>>>();
  function publishPresence() {
    for (const client of clients) {
      try {
        client.send("presence", { count: clients.size });
      } catch {
        clients.delete(client);
      }
    }
  }
  const chat = defineService("chat", {
    database: store.database,
    context: ({ request }) => {
      const token = request.headers
        .get("cookie")
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("brick-chat="))
        ?.slice("brick-chat=".length);
      return { user: token ? store.user(token) : null };
    },
  });
  chat.socket({
    name: "live",
    description:
      "Persistent shared conversation with browser fingerprint identities",
    input: {
      say: t.Object({
        text: t.String({ minLength: 1, maxLength: 2000, pattern: "\\S" }),
      }),
    },
    output,
    allowedOrigins,
    authorize: ({ ctx }) => ctx.user != null,
    open: ({ ctx, socket }) => {
      if (!ctx.user) return;
      socket.send("connected", ctx.user);
      // Chunk stored history so every frame fits the socket payload limit.
      let batch: ChatMessage[] = [];
      for (const message of store.history()) {
        const next = [...batch, message];
        if (
          batch.length &&
          new TextEncoder().encode(JSON.stringify(next)).byteLength > 32 * 1024
        ) {
          socket.send("history", { messages: batch, done: false });
          batch = [];
        }
        batch.push(message);
      }
      socket.send("history", { messages: batch, done: true });
      clients.add(socket);
      publishPresence();
    },
    close: ({ socket }) => {
      clients.delete(socket);
      publishPresence();
    },
    handlers: {
      say: ({ input, ctx }) => {
        if (!ctx.user) return;
        const message = store.save(ctx.user.id, input.text);
        for (const client of clients) {
          try {
            client.send("message", message);
          } catch {
            clients.delete(client);
          }
        }
      },
    },
  });
  const app = brick({
    services: [chat],
    telemetry: true,
    endpoints: [
      {
        method: "POST",
        path: "/session",
        handler: ({ request, body }) => {
          const origin = request.headers.get("origin");
          if (
            origin &&
            origin !== new URL(request.url).origin &&
            !allowedOrigins.includes(origin)
          )
            return new Response("Origin refused", { status: 403 });
          if (!sessionInput.Check(body))
            return new Response("Invalid browser fingerprint", { status: 400 });
          const { token, user } = store.session(body.fingerprint);
          return Response.json(
            { name: user.name },
            {
              headers: {
                "set-cookie": `brick-chat=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`,
              },
            },
          );
        },
      },
    ],
  });
  app.cleanup(() => store.close());
  return app;
}
