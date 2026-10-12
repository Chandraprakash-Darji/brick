import { beforeEach, expect, it } from "bun:test";
import {
  brick,
  defineDatabase,
  defineService,
  getGlobalRegistry,
  resetGlobalRegistry,
  sqliteTable,
  text,
} from "../src";

beforeEach(resetGlobalRegistry);

it("exports default routes and a single database config before an app is created", () => {
  const service = defineService("records", { database: defineDatabase() });
  service.action({ name: "save", execute: () => true });
  const schema = getGlobalRegistry().exportArchitecture().services[0]!;
  expect(schema.actions[0]).toMatchObject({
    name: "save",
    method: "POST",
    path: "/api/records/save",
  });
  expect(schema.options).not.toHaveProperty("database");
  expect(schema.databaseConfig).toMatchObject({ engine: "sqlite" });
});

it("exports only registered HTTP routes and keeps each app's route table", async () => {
  const service = defineService("records");
  service.action({
    name: "first",
    method: "GET",
    path: "/same",
    execute: () => true,
  });
  service.action({
    name: "shadowed",
    method: "GET",
    path: "/same",
    execute: () => false,
  });
  service.action({ name: "save", execute: () => true });
  service.action({
    name: "health",
    method: "GET",
    path: "/_health",
    execute: () => false,
  });
  service.action({
    name: "raw",
    method: "GET",
    path: "/raw",
    execute: () => false,
  });
  service.tool({ name: "internal", execute: () => true });
  const first = brick({
    services: [service],
    prefix: "/v2",
    requestLogging: false,
    endpoints: [{ method: "GET", path: "/raw", handler: () => true }],
  });
  const registry = getGlobalRegistry();
  const architecture = registry.exportArchitecture();
  expect(
    architecture.services[0]!.actions.find((action) => action.name === "save"),
  ).toMatchObject({ method: "POST", path: "/v2/records/save" });
  expect(
    architecture.services[0]!.actions.some(
      (action) => action.name === "internal",
    ),
  ).toBe(false);
  for (const name of ["shadowed", "health", "raw"]) {
    const action = architecture.services[0]!.actions.find(
      (action) => action.name === name,
    );
    expect(action).toBeDefined();
    expect(action).not.toHaveProperty("method");
    expect(action).not.toHaveProperty("path");
  }
  brick({ services: [service], prefix: "/v3", requestLogging: false });
  expect(
    registry
      .exportArchitecture()
      .services[0]!.actions.find((action) => action.name === "save"),
  ).toMatchObject({ method: "POST", path: "/v3/records/save" });
  const response = await first.handle(
    new Request("http://localhost/_brick/services"),
  );
  expect(await response.json()).toEqual(
    JSON.parse(JSON.stringify(architecture)),
  );
  registry.clear();
  expect(registry.exportArchitecture().services).toEqual([]);
});

it("keeps declarations open when exporting before app construction", () => {
  const service = defineService("setup");
  service.action({ name: "first", execute: () => true });
  getGlobalRegistry().exportArchitecture();
  expect(service.isBuilt).toBe(false);
  const table = sqliteTable("later", { id: text("id").primaryKey() });
  expect(() => service.resource({ name: "later", table })).not.toThrow();
  expect(() =>
    service.contributePreparation({ name: "later", prepare: () => undefined }),
  ).not.toThrow();
  service.action({ name: "second", method: "GET", execute: () => true });
  const architecture = getGlobalRegistry().exportArchitecture();
  expect(
    architecture.services[0]!.actions.find(
      (action) => action.name === "second",
    ),
  ).toMatchObject({ method: "GET", path: "/api/setup/second" });
  expect(service.isBuilt).toBe(false);
  brick({ services: [service], requestLogging: false });
  expect(service.isBuilt).toBe(true);
});
