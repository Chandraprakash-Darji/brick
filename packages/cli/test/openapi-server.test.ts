import { describe, it, expect, beforeEach } from "bun:test";
import {
  defineService,
  defineAction,
  t,
  resetGlobalRegistry,
} from "@brick/core";
import { createBrickServer } from "../src/server";

describe("@brick/cli OpenAPI & Interactive Documentation Server", () => {
  beforeEach(() => {
    resetGlobalRegistry();
  });

  it("should serve OpenAPI 3.1 JSON at /openapi.json and documentation at /docs & /swagger", async () => {
    const pagesService = defineService("pages", {
    });

    const createPage = defineAction({
      name: "createPage",
      description: "Create a page in workspace",
      input: t.Object({
        title: t.String(),
        slug: t.String(),
      }),
      output: t.Object({
        id: t.String(),
        title: t.String(),
      }),
      execute: async ({ input }) => ({
        id: "p_1",
        title: input.title,
      }),
    });

    pagesService.action(createPage);

    const app = createBrickServer({
      title: "Pages Platform API",
      version: "2.5.0",
      services: [pagesService],
    });

    // 1. Test /openapi.json
    const specResponse = await app.handle(new Request("http://localhost/openapi.json"));
    expect(specResponse.status).toBe(200);
    const spec = await specResponse.json();

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Pages Platform API");
    expect(spec.info.version).toBe("2.5.0");
    expect(spec.paths["/api/pages/createPage"]).toBeDefined();
    expect(spec.paths["/api/pages/createPage"].post).toBeDefined();
    expect(spec.paths["/api/pages/createPage"].post.summary).toBe("pages.createPage");
    expect(spec.paths["/api/pages/createPage"].post.requestBody).toBeDefined();

    // 2. Test /docs (Scalar UI)
    const docsResponse = await app.handle(new Request("http://localhost/docs"));
    expect(docsResponse.status).toBe(200);
    expect(docsResponse.headers.get("content-type")).toContain("text/html");
    const docsHtml = await docsResponse.text();
    expect(docsHtml).toContain("@scalar/api-reference");
    expect(docsHtml).toContain("data-url=\"/openapi.json\"");
    expect(docsHtml).toContain("Pages Platform API — API Reference");

    // 3. Test /swagger (Swagger UI)
    const swaggerResponse = await app.handle(new Request("http://localhost/swagger"));
    expect(swaggerResponse.status).toBe(200);
    expect(swaggerResponse.headers.get("content-type")).toContain("text/html");
    const swaggerHtml = await swaggerResponse.text();
    expect(swaggerHtml).toContain("swagger-ui");
    expect(swaggerHtml).toContain("url: \"/openapi.json\"");
  });

  it("should allow disabling documentation via docs: false", async () => {
    const s = defineService("empty");
    const app = createBrickServer({
      docs: false,
      services: [s],
    });

    const specResponse = await app.handle(new Request("http://localhost/openapi.json"));
    expect(specResponse.status).toBe(404);

    const docsResponse = await app.handle(new Request("http://localhost/docs"));
    expect(docsResponse.status).toBe(404);
  });
});
