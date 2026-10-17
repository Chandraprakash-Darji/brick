import { describe, expect, it } from "bun:test";
import {
  apiEntries,
  apiHref,
  documentSlugs,
  filterGroups,
  groupOperations,
  selectOperation,
} from "../dashboard/api-operations";

const own = {
  openapi: "3.0.3",
  tags: [{ name: "pages" }, { name: "unused" }],
  paths: {
    "/api/pages": {
      get: { summary: "List pages", tags: ["pages"] },
      post: { operationId: "createPage", tags: ["pages"] },
    },
    "/api/pages/{id}": {
      get: { tags: ["pages"] },
      delete: { tags: ["pages"], deprecated: true },
    },
    "/health": { summary: "Health check", get: {} },
    "/api/search": { get: { tags: ["search"] }, parameters: [] },
  },
};

describe("groupOperations", () => {
  it("groups by first tag in the document's tag order, untagged last", () => {
    const groups = groupOperations(own);
    expect(groups.map((group) => group.name)).toEqual(["pages", "search", ""]);
    expect(groups[0].operations).toEqual([
      {
        method: "get",
        path: "/api/pages",
        title: "List pages",
        deprecated: false,
      },
      {
        method: "post",
        path: "/api/pages",
        title: "Create Page",
        deprecated: false,
      },
      {
        method: "get",
        path: "/api/pages/{id}",
        title: "/api/pages/{id}",
        deprecated: false,
      },
      {
        method: "delete",
        path: "/api/pages/{id}",
        title: "/api/pages/{id}",
        deprecated: true,
      },
    ]);
  });

  it("titles an operation as the page does: summary, else its id made readable, else the path", () => {
    const [group] = groupOperations({
      paths: {
        "/health": { summary: "Health check", get: {} },
        "/session": { get: { operationId: "getSession" } },
        "/sign-up": { post: { operationId: "auth.signUpWithEmail" } },
        "/plain": { get: {} },
      },
    });
    expect(group.operations.map((operation) => operation.title)).toEqual([
      "Health check",
      "Get Session",
      "Sign Up With Email",
      "/plain",
    ]);
  });

  it("copes with a document that has no paths or odd entries", () => {
    expect(groupOperations({})).toEqual([]);
    expect(
      groupOperations({ paths: { "/a": null, "/b": { get: null, put: {} } } }),
    ).toEqual([
      {
        name: "",
        operations: [
          { method: "put", path: "/b", title: "/b", deprecated: false },
        ],
      },
    ]);
  });
});

describe("documentSlugs", () => {
  it("names documents for the address and keeps the names apart", () => {
    expect(
      documentSlugs([
        { title: "Pages API", document: {} },
        { title: "Better Auth", document: {} },
        { title: "Pages API", document: {} },
        { title: "???", document: {} },
      ]),
    ).toEqual(["pages-api", "better-auth", "pages-api-2", "api-4"]);
  });
});

describe("apiEntries", () => {
  it("points each document at the app being shown", () => {
    const [entry] = apiEntries(
      [{ title: "Pages API", document: own }],
      "http://localhost:5174",
    );
    expect(entry.slug).toBe("pages-api");
    expect(entry.document.servers).toEqual([
      { url: "http://localhost:5174", description: "Dev server" },
    ]);
    expect(entry.groups).toHaveLength(3);
  });
});

describe("apiHref and selectOperation", () => {
  const entries = apiEntries(
    [
      { title: "Pages API", document: own },
      { title: "Auth", document: { paths: { "/sign-in": { post: {} } } } },
    ],
    undefined,
  );

  it("writes an operation as document, method, and path segments", () => {
    expect(apiHref("pages-api", "get", "/api/pages/{id}")).toBe(
      "#/apis/pages-api/get/api/pages/%7Bid%7D",
    );
    expect(apiHref("pages-api", "get", "/")).toBe("#/apis/pages-api/get");
  });

  it("finds the operation an address names, in any document", () => {
    const found = selectOperation(entries, [
      "pages-api",
      "post",
      "api",
      "pages",
    ]);
    expect(found?.entry.slug).toBe("pages-api");
    expect(found?.operation).toMatchObject({
      method: "post",
      path: "/api/pages",
    });
    expect(
      selectOperation(entries, ["auth", "post", "sign-in"])?.entry.slug,
    ).toBe("auth");
    // Round trip through the route: segments come back decoded.
    expect(
      selectOperation(entries, ["pages-api", "delete", "api", "pages", "{id}"])
        ?.operation.deprecated,
    ).toBe(true);
  });

  it("opens the first operation when the address names none that exists", () => {
    expect(selectOperation(entries, [])?.operation.path).toBe("/api/pages");
    expect(
      selectOperation(entries, ["pages-api", "get", "gone"])?.operation.path,
    ).toBe("/api/pages");
    expect(selectOperation(entries, ["auth"])?.entry.slug).toBe("auth");
    expect(selectOperation(entries, ["nope", "get", "x"])?.entry.slug).toBe(
      "pages-api",
    );
    expect(selectOperation([], ["pages-api"])).toBeUndefined();
  });
});

describe("filterGroups", () => {
  const groups = groupOperations(own);

  it("keeps operations that match every word", () => {
    const found = filterGroups(groups, "delete pages");
    expect(found).toHaveLength(1);
    expect(found[0].operations.map((item) => item.method)).toEqual(["delete"]);
    expect(filterGroups(groups, "search")[0].name).toBe("search");
    expect(filterGroups(groups, "create page")[0].operations).toHaveLength(1);
  });

  it("returns everything for an empty query and nothing for no match", () => {
    expect(filterGroups(groups, "  ")).toBe(groups);
    expect(filterGroups(groups, "zzz")).toEqual([]);
  });
});
