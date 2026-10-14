import { expect, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { brick, defineDatabase, defineService, t } from "../src/effect";

class Dependency extends Context.Tag("effect-app/Dependency")<
  Dependency,
  { value: number }
>() {}

test("the app acquires one dependency layer, initializes once, and disposes once", async () => {
  const events: string[] = [];
  const layer = Layer.scoped(
    Dependency,
    Effect.acquireRelease(
      Effect.sync(() => {
        events.push("acquire");
        return { value: 42 };
      }),
      () =>
        Effect.sync(() => {
          events.push("release");
        }),
    ),
  );
  const service = defineService("effect_app_lifetime", {
    lifecycle: {
      onInit: () =>
        Effect.flatMap(Dependency, () =>
          Effect.sync(() => {
            events.push("init");
          }),
        ),
      onDestroy: () =>
        Effect.flatMap(Dependency, () =>
          Effect.sync(() => {
            events.push("destroy");
          }),
        ),
    },
  });
  service.action({
    name: "value",
    output: t.Number(),
    execute: () => Effect.map(Dependency, (d) => d.value),
  });
  const app = brick({
    services: [service],
    layer,
    docs: false,
    requestLogging: false,
    endpoints: [
      {
        method: "GET",
        path: "/value",
        handler: () => Effect.map(Dependency, (d) => ({ value: d.value })),
      },
    ],
  });
  await Promise.all([app.initialize(), app.initialize()]);
  expect(events).toEqual(["acquire", "init"]);
  expect(
    await (await app.handle(new Request("http://localhost/value"))).json(),
  ).toEqual({ value: 42 });
  expect(
    (
      await Effect.runPromise(
        app.handleEffect(
          new Request("http://localhost/api/effect_app_lifetime/value", {
            method: "POST",
          }),
        ),
      )
    ).status,
  ).toBe(200);
  const second = brick({
    services: [service],
    layer: Layer.succeed(Dependency, { value: 99 }),
    docs: false,
    requestLogging: false,
  });
  const response = await second.handle(
    new Request("http://localhost/api/effect_app_lifetime/value", {
      method: "POST",
    }),
  );
  expect(await response.json()).toBe(99);
  await second.dispose();
  await Promise.all([app.dispose(), app.dispose()]);
  expect(events).toEqual([
    "acquire",
    "init",
    "init",
    "destroy",
    "destroy",
    "release",
  ]);
  await expect(
    app.handle(new Request("http://localhost/value")),
  ).rejects.toThrow("disposed");
});

test("failed initialization runs destruction and layer finalizers", async () => {
  const events: string[] = [];
  const failure = new Error("startup failed");
  const layer = Layer.scoped(
    Dependency,
    Effect.acquireRelease(Effect.succeed({ value: 1 }), () =>
      Effect.sync(() => {
        events.push("release");
      }),
    ),
  );
  const service = defineService("effect_app_startup_failure", {
    lifecycle: {
      onInit: () => Effect.fail(failure),
      onDestroy: () =>
        Effect.sync(() => {
          events.push("destroy");
        }),
    },
  });
  const app = brick({ services: [service], layer, docs: false });
  await expect(app.initialize()).rejects.toBe(failure);
  expect(events).toEqual(["destroy", "release"]);
  await app.dispose();
  expect(events).toEqual(["destroy", "release"]);
});

test("aborting an HTTP action interrupts native execution and runs finalizers", async () => {
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let released = false;
  const service = defineService("effect_app_abort");
  service.action({
    name: "wait",
    execute: () =>
      Effect.ensuring(
        Effect.zipRight(Effect.sync(started), Effect.never),
        Effect.sync(() => {
          released = true;
        }),
      ),
  });
  const app = brick({
    services: [service],
    docs: false,
    requestLogging: false,
  });
  const controller = new AbortController();
  const response = app.handle(
    new Request("http://localhost/api/effect_app_abort/wait", {
      method: "POST",
      signal: controller.signal,
    }),
  );
  await entered;
  controller.abort();
  await response;
  expect(released).toBe(true);
  await app.dispose();
});

test("disposing a rebound app restores the previous runtime binding", async () => {
  const service = defineService("effect_app_rebind");
  service.action({
    name: "value",
    output: t.Number(),
    execute: () => Effect.map(Dependency, (d) => d.value),
  });
  const first = brick({
    services: [service],
    layer: Layer.succeed(Dependency, { value: 1 }),
    docs: false,
    requestLogging: false,
  });
  const second = brick({
    services: [service],
    layer: Layer.succeed(Dependency, { value: 2 }),
    docs: false,
    requestLogging: false,
  });
  try {
    await second.dispose();
    const action = service.getAction("value")!;
    expect(await action.run()).toBe(1);
  } finally {
    await first.dispose();
  }
});

test("database handles close only after the last app releases them", async () => {
  const handle = defineDatabase();
  const service = defineService("effect_app_shared_db", {
    database: handle,
  });
  service.action({
    name: "ping",
    output: t.String(),
    execute: () => Effect.succeed("pong"),
  });
  const first = brick({
    services: [service],
    docs: false,
    requestLogging: false,
  });
  const second = brick({
    services: [service],
    docs: false,
    requestLogging: false,
  });
  try {
    await first.dispose();
    expect(() => handle.getDb()).not.toThrow();
    expect(await service.getAction("ping")!.run()).toBe("pong");
    await second.dispose();
    expect(() => handle.getDb()).toThrow("Brick database handle is closed");
  } finally {
    await first.dispose().catch(() => {});
    await second.dispose().catch(() => {});
  }
});

test("a failed app construction never closes handles owned by running apps", async () => {
  const handle = defineDatabase();
  const service = defineService("effect_app_failed_construction", {
    database: handle,
  });
  const running = brick({
    services: [service],
    docs: false,
    requestLogging: false,
  });
  try {
    expect(() =>
      brick({
        services: [service, service],
        docs: false,
        requestLogging: false,
      }),
    ).toThrow("duplicate service");
    expect(() => handle.getDb()).not.toThrow();
  } finally {
    await running.dispose();
  }
  expect(() => handle.getDb()).toThrow("Brick database handle is closed");
});

test("disposal releases acquired handles but never a setDb replacement", async () => {
  const original = defineDatabase();
  const replacement = defineDatabase();
  const service = defineService("effect_app_swapped_db", {
    database: original,
  });
  const app = brick({
    services: [service],
    docs: false,
    requestLogging: false,
  });
  // The replacement belongs to whoever installed it: disposing this app must
  // not close a handle it never acquired, even though it is live at disposal.
  service.setDb(replacement);
  await app.dispose();
  expect(() => original.getDb()).toThrow("Brick database handle is closed");
  expect(() => replacement.getDb()).not.toThrow();
  await replacement.close?.();
});

test("disposing an app never closes a replacement acquired by another app", async () => {
  const shared = defineDatabase();
  const ownerService = defineService("effect_app_replacement_owner", {
    database: shared,
  });
  const owner = brick({
    services: [ownerService],
    docs: false,
    requestLogging: false,
  });
  const borrowerService = defineService("effect_app_replacement_borrower");
  const borrower = brick({
    services: [borrowerService],
    docs: false,
    requestLogging: false,
  });
  // Installed after construction, so the borrowing app never acquired it.
  borrowerService.setDb(shared);
  try {
    await borrower.dispose();
    expect(() => shared.getDb()).not.toThrow();
  } finally {
    await owner.dispose();
  }
  expect(() => shared.getDb()).toThrow("Brick database handle is closed");
});

test("a failed initialization restores the surviving runtime binding", async () => {
  let failInit = false;
  const service = defineService("effect_app_failed_init", {
    lifecycle: {
      onInit: () =>
        failInit ? Effect.fail(new Error("init boom")) : Effect.void,
    },
  });
  service.action({
    name: "value",
    output: t.Number(),
    execute: () => Effect.map(Dependency, (d) => d.value),
  });
  const first = brick({
    services: [service],
    layer: Layer.succeed(Dependency, { value: 1 }),
    docs: false,
    requestLogging: false,
  });
  await first.initialize();
  const second = brick({
    services: [service],
    layer: Layer.succeed(Dependency, { value: 2 }),
    docs: false,
    requestLogging: false,
  });
  failInit = true;
  await expect(second.initialize()).rejects.toThrow("init boom");
  try {
    expect(await service.getAction("value")!.run()).toBe(1);
  } finally {
    await first.dispose();
    await second.dispose().catch(() => {});
  }
});
