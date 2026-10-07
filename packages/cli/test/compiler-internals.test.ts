import { beforeEach, expect, it } from "bun:test";
import { defineService, getGlobalRegistry, resetGlobalRegistry } from "@brickkit/core";
import { brick } from "../src/server";

beforeEach(resetGlobalRegistry);
const request = (path: string) => new Request("http://localhost" + path);

it("pre-renders built-in pages and reuses identical JSON across repeated requests", async () => {
  const service = defineService("internal");
  service.action({ name: "getReady", execute: () => ({ ok: true }) });
  const settings = { services: [service], requestLogging: false, reference: true, title: "Internal API" };
  const compiled = brick(settings), generic = brick({ ...settings, compiler: false });
  for (const path of ["/docs", "/swagger", "/reference", "/openapi.json", "/_brick/services"]) {
    const baseline = await generic.handle(request(path));
    const body = await baseline.text();
    for (let i = 0; i < 3; i++) {
      const response = await compiled.handle(request(path));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(baseline.headers.get("content-type"));
      expect(await response.text()).toBe(body);
    }
  }
  const first = await (await compiled.handle(request("/_health"))).json();
  await Bun.sleep(2);
  const second = await (await compiled.handle(request("/_health"))).json();
  expect(second.status).toBe("ok");
  expect(second.timestamp).toBeGreaterThan(first.timestamp);
  expect(second.uptime).toBeGreaterThan(first.uptime);
});

it("invalidates architecture for definition changes, registry replacement and clear", async () => {
  const service = defineService("initial");
  const registry = getGlobalRegistry();
  const original = registry.exportArchitecture.bind(registry);
  let exports = 0;
  registry.exportArchitecture = () => { exports++; return original(); };
  const app = brick({ requestLogging: false });
  for (let i = 0; i < 3; i++) await (await app.handle(request("/_brick/services"))).json();
  expect(exports).toBe(1);
  service.action({ name: "newAction", execute: () => null });
  const changed = await (await app.handle(request("/_brick/services"))).json();
  expect(changed.services[0].actions[0].name).toBe("newAction");
  expect(exports).toBe(2);
  defineService("newService");
  expect((await (await app.handle(request("/_brick/services"))).json()).services).toHaveLength(2);
  registry.clear();
  expect((await (await app.handle(request("/_brick/services"))).json()).services).toHaveLength(0);
  resetGlobalRegistry();
  defineService("replacement");
  expect((await (await app.handle(request("/_brick/services"))).json()).services[0].name).toBe("replacement");
});

it("invalidates OpenAPI when endpoints or service action definitions are added", async () => {
  const service = defineService("spec");
  const app = brick({ services: [service], requestLogging: false,
    endpoints: [{ method: "GET", path: "/first", handler: () => "first" }] });
  expect((await (await app.handle(request("/openapi.json"))).json()).paths["/first"]).toBeDefined();
  app.endpoint({ method: "GET", path: "/later", handler: () => "later" });
  service.action({ name: "laterAction", execute: () => "later" });
  const spec = await (await app.handle(request("/openapi.json"))).json();
  expect(spec.paths["/later"]).toBeDefined();
  expect(spec.paths["/api/spec/laterAction"]).toBeDefined();
  expect((await (await app.handle(request("/openapi.json"))).json())).toEqual(spec);
});
