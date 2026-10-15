import { expect, test } from "bun:test";
import { Context, Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Brick } from "../src/native";
class Repo extends Context.Service<Repo, string>()("native-lifecycle/Repo") {}
const route = Brick.route(
  "GET",
  "/raw/:slug",
  Effect.gen(function* () {
    const prefix = yield* Repo;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const { params } = yield* HttpRouter.RouteContext;
    return HttpServerResponse.text(
      `${prefix}${params.slug}:${request.headers["x-user"]}`,
    );
  }),
);
const missing = () =>
  // @ts-expect-error Raw routes require their application services.
  Brick.app({ services: [], routes: route, layer: Layer.empty });
void missing;
test("metadata is side-effect free, ready acquires once, raw routes use current request and disposal closes once", async () => {
  let acquired = 0;
  let released = 0;
  const app = Brick.app({
    services: [],
    routes: route,
    layer: Layer.effect(
      Repo,
      Effect.acquireRelease(
        Effect.sync(() => {
          acquired++;
          return "repo:";
        }),
        () =>
          Effect.sync(() => {
            released++;
          }),
      ),
    ),
  });
  app.openApi();
  expect(acquired).toBe(0);
  await Promise.all([app.ready(), app.ready()]);
  expect(acquired).toBe(1);
  const replies = await Promise.all(
    ["alice", "bob"].map((user) =>
      app
        .fetch(
          new Request("http://localhost/raw/hello", {
            headers: { "x-user": user },
          }),
        )
        .then((r) => r.text()),
    ),
  );
  expect(replies).toEqual(["repo:hello:alice", "repo:hello:bob"]);
  await Promise.all([app.dispose(), app.dispose()]);
  expect(released).toBe(1);
  await expect(app.ready()).rejects.toThrow("disposed");
  await expect(
    app.fetch(new Request("http://localhost/raw/no")),
  ).rejects.toThrow("disposed");
});
test("failed startup releases acquired dependencies on disposal", async () => {
  let released = 0;
  const acquired = Layer.effect(
    Repo,
    Effect.acquireRelease(Effect.succeed("repo:"), () =>
      Effect.sync(() => {
        released++;
      }),
    ),
  );
  const broken = Layer.effectDiscard(
    Effect.fail(new Error("startup failed")),
  ).pipe(Layer.provideMerge(acquired));
  const app = Brick.app({ services: [], layer: broken });
  await expect(app.ready()).rejects.toThrow("startup failed");
  await app.dispose();
  expect(released).toBe(1);
});

test("disposal interrupts unfinished startup and releases earlier acquisitions", async () => {
  let acquired!: () => void;
  let released = 0;
  const acquisition = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const dependencies = Layer.effect(
    Repo,
    Effect.acquireRelease(
      Effect.sync(() => {
        acquired();
        return "repo:";
      }),
      () =>
        Effect.sync(() => {
          released++;
        }),
    ),
  );
  const waiting = Layer.effectDiscard(Effect.never).pipe(
    Layer.provideMerge(dependencies),
  );
  const app = Brick.app({ services: [], layer: waiting });
  const startup = app.ready();
  await acquisition;
  await app.dispose();
  await expect(startup).rejects.toThrow();
  expect(released).toBe(1);
});

test("disposal interrupts active requests before releasing application dependencies", async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const events: string[] = [];
  const resource = Layer.effect(
    Repo,
    Effect.acquireRelease(Effect.succeed("repo:"), () =>
      Effect.sync(() => {
        events.push("application closed");
      }),
    ),
  );
  const waiting = Brick.route(
    "GET",
    "/wait",
    Effect.gen(function* () {
      yield* Repo;
      yield* Effect.acquireRelease(Effect.sync(entered), () =>
        Effect.sync(() => {
          events.push("request closed");
        }),
      );
      return yield* Effect.never;
    }),
  );
  const app = Brick.app({ services: [], routes: waiting, layer: resource });
  const response = app.fetch(new Request("http://localhost/wait"));
  await started;
  await app.dispose();
  expect((await response).status).toBe(499);
  expect(events).toEqual(["request closed", "application closed"]);
});

test("disposal closes an unread streaming response scope before its application dependencies", async () => {
  const events: string[] = [];
  const resource = Layer.effect(
    Repo,
    Effect.acquireRelease(Effect.succeed("repo:"), () =>
      Effect.sync(() => {
        events.push("application closed");
      }),
    ),
  );
  const streaming = Brick.route(
    "GET",
    "/stream",
    Effect.gen(function* () {
      yield* Repo;
      yield* Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => {
          events.push("request closed");
        }),
      );
      return HttpServerResponse.stream(Stream.never);
    }),
  );
  const app = Brick.app({ services: [], routes: streaming, layer: resource });
  const response = await app.fetch(new Request("http://localhost/stream"));
  expect(response.status).toBe(200);
  await app.dispose();
  expect(events).toEqual(["request closed", "application closed"]);
});
