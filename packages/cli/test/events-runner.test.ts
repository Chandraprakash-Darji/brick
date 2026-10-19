import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { resetGlobalRegistry } from "@brickkit/core";
import {
  startDevApplication,
  startProdServer,
  startWorker,
} from "../src/runner";

const fixture = (name: string) =>
  new URL(`./fixtures/${name}.ts`, import.meta.url).pathname;

async function waitFor(check: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  return check();
}

function createNote(port: number) {
  return fetch(`http://localhost:${port}/api/note`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: "hello" }),
  });
}

const handlers = (signal: "SIGINT" | "SIGTERM") => process.listeners(signal);
let servers: { stop(): unknown }[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
});

describe("event delivery in the runner", () => {
  it("brick start delivers an event after an HTTP write, and exits after finishing deliveries", async () => {
    resetGlobalRegistry();
    const before = { int: handlers("SIGINT"), term: handlers("SIGTERM") };
    const app: any = await startProdServer({
      entry: fixture("events-prod"),
      port: 45131,
    });
    servers.push({ stop: () => app.stop() }, { stop: () => app.events.stop() });
    const { received } = await import(fixture("events-prod"));

    try {
      const response = await createNote(45131);
      expect(response.status).toBe(200);
      expect(
        await waitFor(() => received.some((payload: any) => payload.row)),
      ).toBe(true);
      expect(received.find((payload: any) => payload.row)).toMatchObject({
        id: 1,
        row: { id: 1, body: "hello" },
      });

      expect(handlers("SIGTERM")).toHaveLength(before.term.length + 1);
      expect(handlers("SIGINT")).toHaveLength(before.int.length + 1);
      // Not `once`: signal-exit, bundled with the workflow runtime, re-raises a
      // signal when it finds no listener left, and `once` removes ours first.
      const exit = spyOn(process, "exit").mockImplementation(
        (() => {}) as never,
      );
      try {
        process.emit("SIGTERM");
        expect(await waitFor(() => exit.mock.calls.length > 0)).toBe(true);
        expect(exit).toHaveBeenCalledWith(0);
        expect(handlers("SIGTERM")).toHaveLength(before.term.length + 1);
      } finally {
        exit.mockRestore();
      }
    } finally {
      for (const listener of handlers("SIGTERM"))
        if (!before.term.includes(listener)) process.off("SIGTERM", listener);
      for (const listener of handlers("SIGINT"))
        if (!before.int.includes(listener)) process.off("SIGINT", listener);
    }
  });

  it("brick start delivers events that were already pending when it booted", async () => {
    resetGlobalRegistry();
    const { seedPending, received } = await import(fixture("events-prod"));
    seedPending();
    const before = { int: handlers("SIGINT"), term: handlers("SIGTERM") };
    const app: any = await startProdServer({
      entry: fixture("events-prod"),
      port: 45133,
    });
    servers.push({ stop: () => app.stop() }, { stop: () => app.events.stop() });
    try {
      expect(
        await waitFor(() => received.some((payload: any) => payload.seeded)),
      ).toBe(true);
    } finally {
      for (const listener of handlers("SIGTERM"))
        if (!before.term.includes(listener)) process.off("SIGTERM", listener);
      for (const listener of handlers("SIGINT"))
        if (!before.int.includes(listener)) process.off("SIGINT", listener);
    }
  });

  it("brick worker delivers pending events without listening on a port", async () => {
    resetGlobalRegistry();
    const { seedPending, received } = await import(fixture("events-worker"));
    seedPending();
    const before = { int: handlers("SIGINT"), term: handlers("SIGTERM") };
    const app: any = await startWorker({ entry: fixture("events-worker") });
    servers.push({ stop: () => app.events.stop() });
    try {
      expect(
        await waitFor(() => received.some((payload: any) => payload.seeded)),
      ).toBe(true);
      expect(app.server).toBeFalsy();
      expect(handlers("SIGTERM")).toHaveLength(before.term.length + 1);
    } finally {
      for (const listener of handlers("SIGTERM"))
        if (!before.term.includes(listener)) process.off("SIGTERM", listener);
      for (const listener of handlers("SIGINT"))
        if (!before.int.includes(listener)) process.off("SIGINT", listener);
    }
  });

  it("brick worker refuses an app that only records events, or has none", async () => {
    resetGlobalRegistry();
    await expect(
      startWorker({ entry: fixture("events-record-only") }),
    ).rejects.toThrow("only records events");
  });

  it("brick dev delivers events that were already pending when it booted", async () => {
    resetGlobalRegistry();
    const { seedPending, received } = await import(fixture("events-dev"));
    seedPending();
    const app: any = await startDevApplication({
      entry: fixture("events-dev"),
      port: 45134,
    });
    servers.push({ stop: () => app.stop() }, { stop: () => app.events.stop() });
    expect(
      await waitFor(() => received.some((payload: any) => payload.seeded)),
    ).toBe(true);
  });

  it("brick dev delivers an event after an HTTP write", async () => {
    resetGlobalRegistry();
    const app: any = await startDevApplication({
      entry: fixture("events-dev"),
      port: 45132,
    });
    servers.push({ stop: () => app.stop() }, { stop: () => app.events.stop() });
    const { received } = await import(fixture("events-dev"));

    const response = await createNote(45132);
    expect(response.status).toBe(200);
    expect(
      await waitFor(() => received.some((payload: any) => payload.row)),
    ).toBe(true);
    expect(received.find((payload: any) => payload.row)).toMatchObject({
      row: { body: "hello" },
    });
  });
});
