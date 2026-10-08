import { expect, it } from "bun:test";
import { defineService } from "@brickkit/core";
import { brickFromContract } from "../src/contract";

it("keeps tool-only services and contract leaves out of routes and OpenAPI", async () => {
  const service = defineService("hidden_tools");
  const tool = service.tool({ name: "hidden", execute: () => "secret" });
  for (const contract of [{ service }, { tool }]) {
    const app = brickFromContract(contract);
    const request = new Request("http://localhost/api/hidden_tools/hidden", {
      method: "POST",
    });
    expect((await app.handle(request)).status).toBe(404);
    const spec = await (
      await app.handle(new Request("http://localhost/openapi.json"))
    ).json();
    expect(spec.paths["/api/hidden_tools/hidden"]).toBeUndefined();
  }
});

it("serves opted-in tools through HTTP with OpenAPI entries", async () => {
  const service = defineService("http_tools");
  const optedIn = service.tool({
    name: "visible",
    http: true,
    execute: () => "visible",
  });
  const registered = service.tool({
    name: "registered",
    execute: () => "registered",
  });
  service.action(registered);
  const app = brickFromContract({ optedIn, registered });
  for (const name of ["visible", "registered"]) {
    const response = await app.handle(
      new Request(`http://localhost/api/http_tools/${name}`, {
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(name);
  }
  const spec = await (
    await app.handle(new Request("http://localhost/openapi.json"))
  ).json();
  expect(spec.paths["/api/http_tools/visible"]).toBeDefined();
  expect(spec.paths["/api/http_tools/registered"]).toBeDefined();
});
