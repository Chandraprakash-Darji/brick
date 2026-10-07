import { describe, it, expect, beforeEach } from "bun:test";
import {
  defineService,
  defineDatabase,
  defineAction,
  t,
  resetGlobalRegistry,
  generateOpenApiSpec,
} from "../src";

describe("OpenAPI 3.1 Specification Generator", () => {
  beforeEach(() => {
    resetGlobalRegistry();
  });

  it("should generate a complete OpenAPI 3.1.0 specification from service registry", () => {
    const pagesService = defineService("pages", { database: defineDatabase() });

    // 1. Action with input, output, errors, tags
    const createPage = defineAction({
      name: "createPage",
      description: "Create a new page",
      tags: ["content", "pages"],
      input: t.Object({
        title: t.String({ description: "Page title" }),
        slug: t.String({ pattern: "^[a-z0-9-]+$" }),
        isPublic: t.Optional(t.Boolean()),
      }),
      output: t.Object({
        id: t.String(),
        title: t.String(),
        slug: t.String(),
      }),
      errors: {
        SLUG_EXISTS: {
          status: 409,
          message: "Slug is already taken",
        },
      },
      authorize: () => true,
      execute: async ({ input }) => ({
        id: "p_1",
        title: input.title,
        slug: input.slug,
      }),
    });

    // 2. Read-like GET action with query parameters
    const getPage = defineAction({
      name: "getPage",
      description: "Get page by id",
      input: t.Object({
        id: t.String({ description: "Target page ID" }),
      }),
      output: t.Object({
        id: t.String(),
        title: t.String(),
      }),
      execute: async ({ input }) => ({
        id: input.id,
        title: "Test",
      }),
    });

    pagesService.action(createPage).action(getPage);

    const spec = generateOpenApiSpec({
      title: "Pages Publishing Mesh",
      version: "1.2.0",
      description: "Production API specification",
    });

    // 1. Root Metadata
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Pages Publishing Mesh");
    expect(spec.info.version).toBe("1.2.0");
    expect(spec.info.description).toBe("Production API specification");

    // 2. Tags
    expect(spec.tags).toBeDefined();
    expect(spec.tags.some((t: any) => t.name === "pages")).toBe(true);

    // 3. POST /api/pages/createPage
    const createPath = spec.paths["/api/pages/createPage"];
    expect(createPath).toBeDefined();
    expect(createPath.post).toBeDefined();
    expect(createPath.post.operationId).toBe("pages_createPage_post");
    expect(createPath.post.tags).toEqual(["content", "pages"]);
    expect(createPath.post.summary).toBe("pages.createPage");
    expect(createPath.post.description).toBe("Create a new page");

    // Request Body
    expect(createPath.post.requestBody.required).toBe(true);
    expect(
      createPath.post.requestBody.content["application/json"].schema.properties
        .title,
    ).toBeDefined();
    expect(
      createPath.post.requestBody.content["application/json"].schema.properties
        .slug,
    ).toBeDefined();

    // Responses (200, 400, 403, 409, 500)
    expect(
      createPath.post.responses["200"].content["application/json"].schema
        .properties.id,
    ).toBeDefined();
    expect(createPath.post.responses["400"]).toBeDefined();
    expect(createPath.post.responses["403"]).toBeDefined();
    expect(createPath.post.responses["409"]).toBeDefined();
    expect(createPath.post.responses["409"].description).toBe(
      "Slug is already taken",
    );
    expect(createPath.post.responses["500"]).toBeDefined();

    // Security
    expect(createPath.post.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
    expect(spec.components.securitySchemes.bearerAuth.type).toBe("http");
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe("bearer");

    // 4. GET & POST /api/pages/getPage
    const getPath = spec.paths["/api/pages/getPage"];
    expect(getPath).toBeDefined();
    expect(getPath.post).toBeDefined();
    expect(getPath.get).toBeDefined();
    expect(getPath.get.operationId).toBe("pages_getPage_get");
    expect(getPath.get.parameters).toBeDefined();
    expect(getPath.get.parameters[0].name).toBe("id");
    expect(getPath.get.parameters[0].in).toBe("query");
    expect(getPath.get.parameters[0].required).toBe(true);
  });

  it("should handle actions without inputs, outputs, or authorization cleanly", () => {
    const healthService = defineService("system");
    const ping = defineAction({
      name: "ping",
      execute: async () => ({ status: "ok" }),
    });

    healthService.action(ping);

    const spec = generateOpenApiSpec({ services: [healthService] });

    expect(spec.openapi).toBe("3.1.0");
    const path = spec.paths["/api/system/ping"];
    expect(path.post).toBeDefined();
    expect(path.post.requestBody).toBeUndefined();
    expect(path.post.security).toBeUndefined();
    expect(path.post.responses["200"]).toBeDefined();
    expect(spec.components).toBeUndefined();
  });
});
