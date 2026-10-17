import { describe, expect, it } from "bun:test";
import { defineService, getGlobalRegistry } from "../src";

describe("architecture export", () => {
  it("can be structured-cloned when a service sets functions in its options", () => {
    const docs = defineService("architecture_clone_docs", {
      context: () => ({ tenant: "acme" }),
      auth: { requireAuth: true, policy: () => true },
      lifecycle: { onInit: async () => {}, onDestroy: async () => {} },
    });

    const architecture = getGlobalRegistry().exportArchitecture({
      services: [docs],
      routes: [],
    });

    // The dev dashboard sends the architecture over IPC, which uses structured
    // clone and throws on functions. The schema is data, so no function is in it.
    expect(() => structuredClone(architecture)).not.toThrow();
    // Functions are left out; an object that held only functions stays as {}.
    expect(architecture.services[0].options).toEqual({
      auth: { requireAuth: true },
      lifecycle: {},
    });
  });
});
