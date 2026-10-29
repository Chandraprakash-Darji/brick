import { beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { Database } from "bun:sqlite";
import { resetGlobalRegistry } from "@brickkit/core";
import { createChatApp } from "../src/room";
import type { ChatMessage } from "../src/store";
import { createChatStore } from "../src/store";

beforeEach(resetGlobalRegistry);
const fingerprintA = "a".repeat(32);
const fingerprintB = "b".repeat(32);

async function join(base: string, fingerprint: string) {
  const session = await fetch(base + "/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fingerprint }),
  });
  expect(session.status).toBe(200);
  const cookie = session.headers.get("set-cookie")!.split(";")[0]!;
  const socket = new WebSocket(base.replace(/^http/, "ws") + "/api/chat/live", {
    headers: { origin: "http://localhost:5178", cookie },
  });
  return new Promise<{
    socket: WebSocket;
    id: string;
    name: string;
    history: ChatMessage[];
  }>((resolve, reject) => {
    let id = "";
    let name = "";
    const history: ChatMessage[] = [];
    socket.onerror = reject;
    socket.onclose = ({ code }) =>
      reject(new Error(`Socket closed while joining: ${code}`));
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.event === "connected") {
        id = message.data.id;
        name = message.data.name;
      }
      if (message.event === "history") {
        history.push(...message.data.messages);
        if (message.data.done) resolve({ socket, id, name, history });
      }
    };
  });
}
function nextMessage(socket: WebSocket): Promise<ChatMessage> {
  return new Promise((resolve) => {
    const listener = ({ data }: MessageEvent) => {
      const message = JSON.parse(String(data));
      if (message.event === "message") {
        socket.removeEventListener("message", listener);
        resolve(message.data);
      }
    };
    socket.addEventListener("message", listener);
  });
}
function send(socket: WebSocket, text: string) {
  socket.send(JSON.stringify({ event: "say", data: { text } }));
}

it("broadcasts saved messages and restores the same fingerprint identity on reconnect", async () => {
  const app = createChatApp(":memory:").listen(0);
  const sockets: WebSocket[] = [];
  try {
    const base = `http://localhost:${app.server!.port}`;
    const first = await join(base, fingerprintA);
    sockets.push(first.socket);
    const second = await join(base, fingerprintB);
    sockets.push(second.socket);
    expect(first.id).toBe(fingerprintA);
    expect(second.id).toBe(fingerprintB);
    expect(first.history).toEqual([]);
    const local = nextMessage(first.socket),
      remote = nextMessage(second.socket);
    send(first.socket, "From the first browser");
    const [one, two] = await Promise.all([local, remote]);
    expect(one).toEqual(two);
    expect(two).toMatchObject({
      id: 1,
      text: "From the first browser",
      userId: fingerprintA,
      name: "Guest 1",
    });
    second.socket.close();
    const returning = await join(base, fingerprintA);
    sockets.push(returning.socket);
    expect(returning.id).toBe(first.id);
    expect(returning.name).toBe(first.name);
    expect(returning.history).toEqual([one]);
    const remaining = nextMessage(first.socket);
    send(first.socket, "Still connected");
    expect(await remaining).toMatchObject({
      id: 2,
      text: "Still connected",
      userId: fingerprintA,
    });
  } finally {
    for (const socket of sockets) socket.close();
    await app.stop(true);
  }
});

it("keeps messages and browser identities in SQLite after a server restart", async () => {
  const directory = await mkdtemp(joinPath(tmpdir(), "brick-chat-"));
  const path = joinPath(directory, "chat.sqlite");
  let app = createChatApp(path).listen(0);
  let socket: WebSocket | undefined;
  try {
    const first = await join(
      `http://localhost:${app.server!.port}`,
      fingerprintA,
    );
    socket = first.socket;
    const received = nextMessage(socket);
    send(socket, "Remember this after restart");
    const saved = await received;
    socket.close();
    await app.stop(true);
    resetGlobalRegistry();
    app = createChatApp(path).listen(0);
    const returning = await join(
      `http://localhost:${app.server!.port}`,
      fingerprintA,
    );
    socket = returning.socket;
    expect(returning.id).toBe(fingerprintA);
    expect(returning.name).toBe("Guest 1");
    expect(returning.history).toEqual([saved]);
    const disk = new Database(path, { readonly: true });
    try {
      expect(disk.query("SELECT id, name FROM chat_users").all()).toEqual([
        { id: fingerprintA, name: "Guest 1" },
      ]);
      expect(
        disk.query("SELECT user_id, text FROM chat_messages").all(),
      ).toEqual([
        { user_id: fingerprintA, text: "Remember this after restart" },
      ]);
    } finally {
      disk.close();
    }
  } finally {
    socket?.close();
    await app.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects invalid identity requests and foreign origins", async () => {
  const app = createChatApp(":memory:").listen(0);
  try {
    const base = `http://localhost:${app.server!.port}`;
    expect(
      (await fetch(base + "/session", { method: "POST", body: "not json" }))
        .status,
    ).toBe(400);
    expect(
      (
        await fetch(base + "/session", {
          method: "POST",
          body: JSON.stringify({ fingerprint: "fake" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(base + "/session", {
          method: "POST",
          headers: { origin: "https://another.test" },
          body: JSON.stringify({ fingerprint: fingerprintA }),
        })
      ).status,
    ).toBe(403);
  } finally {
    await app.stop(true);
  }
});

it("loads the latest 50 stored messages in bounded history frames", async () => {
  const directory = await mkdtemp(joinPath(tmpdir(), "brick-chat-history-"));
  const path = joinPath(directory, "chat.sqlite");
  const store = createChatStore(path);
  store.session(fingerprintA);
  for (let i = 0; i < 55; i++) store.save(fingerprintA, "\u0000".repeat(2000));
  await store.close();
  const app = createChatApp(path).listen(0);
  let socket: WebSocket | undefined;
  try {
    const client = await join(
      `http://localhost:${app.server!.port}`,
      fingerprintA,
    );
    socket = client.socket;
    expect(client.history).toHaveLength(50);
    expect(client.history[0]!.id).toBe(6);
    expect(client.history[49]!.id).toBe(55);
    expect(client.history[49]!.text).toBe("\u0000".repeat(2000));
    const disk = new Database(path, { readonly: true });
    try {
      expect(
        disk.query("SELECT count(*) AS count FROM chat_messages").get(),
      ).toEqual({ count: 55 });
    } finally {
      disk.close();
    }
  } finally {
    socket?.close();
    await app.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
