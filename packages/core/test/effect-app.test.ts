import { expect, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { brick, defineService, t } from "../src/effect";

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
