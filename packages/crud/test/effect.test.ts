import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Context, Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { defineDatabase, t, ActionExecutionError } from "@brickkit/core";
import {
  brick,
  defineService,
  defineResourcePlugin,
} from "@brickkit/core/effect";
import { crud } from "../src/effect";

class Policy extends Context.Tag("crud-test-policy")<
  Policy,
  { allow: boolean }
>() {}
const records = sqliteTable("effect_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
});

test("native CRUD composition provides dependencies to policies and scrubbers without an app", async () => {
  const sqlite = new Database(":memory:");
  const database = defineDatabase({ tables: [records], client: sqlite });
  sqlite.exec(
    "CREATE TABLE effect_records (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)",
  );
  const service = defineService("effect_crud_composed", {
    database,
    context: () => Effect.as(Policy, {}),
  });
  const resource = service.resource({ name: "record", table: records }).use(
    crud({
      fields: {
        id: { read: true },
        name: {
          read: true,
          create: true,
          scrub: ({ value }) => Effect.as(Policy, String(value).toUpperCase()),
        },
      },
      access: {
        authorize: () => Effect.map(Policy, (policy) => policy.allow),
        scope: () => Effect.as(Policy, eq(records.id, 1)),
      },
    }),
  );
  try {
    await database.getDb().insert(records).values({ name: "composed" });
    // @ts-expect-error Policy must be provided before running the native action.
    const unresolved: Effect.Effect<unknown, unknown> =
      resource.get.executeEffect({ input: { id: 1 } });
    void unresolved;
    expect(
      await Effect.runPromise(
        resource.get
          .executeEffect({ input: { id: 1 } })
          .pipe(Effect.provide(Layer.succeed(Policy, { allow: true }))),
      ),
    ).toEqual({ id: 1, name: "COMPOSED" });
  } finally {
    sqlite.close();
  }
});

test("Effect CRUD policies, scopes, scrubbers and every hook share the host runtime", async () => {
  const sqlite = new Database(":memory:");
  const database = defineDatabase({ tables: [records], client: sqlite });
  const db = database.getDb();
  sqlite.exec(
    "CREATE TABLE effect_records (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)",
  );
  const service = defineService("effect_crud_hooks", {
    database,
    context: () => Effect.as(Policy, {}),
  });
  const events: string[] = [];
  const hook = (name: string) =>
    Effect.gen(function* () {
      yield* Policy;
      events.push(name);
    });
  const resource = service.resource({ name: "record", table: records }).use(
    crud({
      fields: {
        id: { read: true },
        name: {
          read: true,
          create: true,
          update: true,
          scrub: ({ value }) => Effect.as(Policy, String(value).toUpperCase()),
        },
      },
      access: {
        authorize: () => Effect.map(Policy, (policy) => policy.allow),
        scope: ({ operation }) =>
          Effect.as(
            Policy,
            operation === "create" ? undefined : eq(records.id, 1),
          ),
      },
      hooks: {
        beforeCreate: () => hook("beforeCreate"),
        afterCreate: () => hook("afterCreate"),
        beforeUpdate: () => hook("beforeUpdate"),
        afterUpdate: () => hook("afterUpdate"),
        beforeDelete: () => hook("beforeDelete"),
        afterDelete: () => hook("afterDelete"),
      },
    }),
  );
  const app = brick({
    services: [service],
    layer: Layer.succeed(Policy, { allow: true }),
    docs: false,
    requestLogging: false,
  });
  try {
    await app.initialize();
    expect(await resource.create.run({ name: "first" })).toEqual({
      id: 1,
      name: "FIRST",
    });
    expect(
      await Effect.runPromise(
        resource.get
          .executeEffect({ input: { id: 1 } })
          .pipe(Effect.provideService(Policy, { allow: true })),
      ),
    ).toEqual({ id: 1, name: "FIRST" });
    await db.insert(records).values({ name: "hidden" });
    expect(await resource.list.run({})).toEqual({
      items: [{ id: 1, name: "FIRST" }],
      limit: 20,
      offset: 0,
    });
    expect(
      await resource.update.run({ id: 1, data: { name: "next" } }),
    ).toEqual({ id: 1, name: "NEXT" });
    expect(await resource.delete.run({ id: 1 })).toEqual({ success: true });
    expect(events).toEqual([
      "beforeCreate",
      "afterCreate",
      "beforeUpdate",
      "afterUpdate",
      "beforeDelete",
      "afterDelete",
    ]);
  } finally {
    await app.dispose();
    sqlite.close();
  }
});

test("Effect CRUD denies failed authorization and preserves callback failures", async () => {
  const sqlite = new Database(":memory:");
  const database = defineDatabase({ tables: [records], client: sqlite });
  const db = database.getDb();
  sqlite.exec(
    "CREATE TABLE effect_records (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)",
  );
  const service = defineService("effect_crud_denied", { database });
  const denied = service.resource({ name: "denied", table: records }).use(
    crud({
      fields: { id: { read: true }, name: { read: true, create: true } },
      access: { authorize: () => Effect.succeed(false) },
    }),
  );
  const failure = new Error("policy unavailable");
  const failed = service.resource({ name: "failed", table: records }).use(
    crud({
      fields: { id: { read: true }, name: { read: true, create: true } },
      access: { authorize: () => Effect.fail(failure) },
    }),
  );
  try {
    await expect(denied.create.run({ name: "no" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
    await expect(
      denied.create.run({ name: "no" }, { user: { id: "guest" } }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
    await expect(failed.create.run({ name: "no" })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      status: 500,
    });
    const failureCause = await failed.create.run({ name: "no" }).then(
      () => null,
      (error) => error,
    );
    expect(failureCause).toBeInstanceOf(ActionExecutionError);
    expect(failureCause.cause).toBe(failure);
    expect(JSON.stringify(failureCause)).not.toContain("policy unavailable");
    expect(await db.select().from(records)).toEqual([]);
  } finally {
    sqlite.close();
  }
});

test("native resource plugin declarations roll back after a setup failure", () => {
  const service = defineService("effect_plugin_rollback");
  const resource = service.resource({ name: "record", table: records });
  const failure = new Error("declaration failed");
  const plugin = defineResourcePlugin({
    name: "effect-rollback",
    setup({ routes }) {
      routes.action({
        name: "probe",
        path: "/probe",
        method: "GET",
        execute: () => Effect.succeed(undefined),
      });
      routes.endpoint({
        name: "extra",
        path: "/extra",
        method: "GET",
        handler: () => Effect.succeed("extra"),
      });
      throw failure;
    },
  });
  expect(() => resource.use(plugin)).toThrow(failure);
  expect(service.listActions()).toEqual([]);
  expect(resource).not.toHaveProperty("probe");
  const app = brick({
    services: [service],
    docs: false,
    requestLogging: false,
  });
  expect(app.listEndpoints()).toEqual([]);
  return app.dispose();
});

for (const compiler of [false, true]) {
  test(`native resource plugin action and endpoint use application dependencies, compiler=${compiler}`, async () => {
    const service = defineService(`effect_plugin_routes_${compiler}`, {
      context: () => Effect.as(Policy, { marker: "resolved" }),
    });
    const resource = service.resource({ name: "record", table: records }).use(
      defineResourcePlugin({
        name: "effect-routes",
        setup({ routes }) {
          const probe = routes.action({
            name: "probe",
            path: "/probe",
            method: "GET",
            input: t.Object({}),
            output: t.String(),
            authorize: () => Effect.map(Policy, (policy) => policy.allow),
            execute: ({ ctx }) => Effect.as(Policy, String(ctx.marker)),
          });
          routes.endpoint({
            name: "extra",
            path: "/extra",
            method: "GET",
            handler: ({ ctx }) => Effect.as(Policy, { marker: ctx.marker }),
          });
          return { probe };
        },
      }),
    );
    const app = brick({
      services: [service],
      layer: Layer.succeed(Policy, { allow: true }),
      compiler,
      docs: false,
      requestLogging: false,
    });
    try {
      await app.initialize();
      expect(await resource.probe.run({})).toBe("resolved");
      const action = await app.handle(
        new Request("http://localhost/api/record/probe"),
      );
      expect(action.status).toBe(200);
      expect(await action.text()).toBe("resolved");
      const endpoint = await app.handle(
        new Request("http://localhost/api/record/extra"),
      );
      expect(endpoint.status).toBe(200);
      expect(await endpoint.json()).toEqual({ marker: "resolved" });
    } finally {
      await app.dispose();
    }
  });
}
