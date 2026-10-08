import { describe, expect, it } from "bun:test";
import { createBrickClient } from "@brickkit/core/client";

import { buildApp } from "../src/api/app";
import { getAuth } from "../src/api/auth";
import type { PagesApi } from "../src/api/contract";
import { appDb, appSql } from "../src/api/db";
import { prepareTestDatabase } from "./database";

describe("local Brick SDK", () => {
  it("reuses the app-owned postgres client", () => {
    expect(appDb.getDb().$client).toBe(appSql);
  });

  it("authenticates and performs CRUD through the real pages app", async () => {
    await prepareTestDatabase();
    const auth = getAuth();
    const signup = await auth.api.signUpEmail({
      asResponse: true,
      body: {
        email: "sdk@example.com",
        name: "SDK",
        password: "sdk-password-123",
      },
    });
    expect(signup.status).toBe(200);
    const cookie = signup.headers.get("set-cookie");
    expect(cookie).toBeTruthy();

    const app = buildApp();
    const api = createBrickClient<PagesApi>({
      baseUrl: "http://localhost:3333",
      headers: { cookie: cookie! },
      fetch: (input, init) =>
        Promise.resolve(app.fetch(new Request(input, init))),
    });
    const created = await api.page.create({
      title: "Local SDK",
      slug: "local-sdk",
      content: "# Hello from the workspace",
      contentType: "markdown",
      isPublic: true,
    });
    expect(created.userId).toBeDefined();
    expect(created.contentType).toBe("markdown");
    expect((await api.page.list({ limit: 100 })).items).toHaveLength(1);
    expect((await api.page.get({ id: created.id })).content).toContain(
      "workspace",
    );
    expect(
      (await api.page.update({ id: created.id, title: "Updated" })).title,
    ).toBe("Updated");
    expect(await api.pages.echo({ message: "local" })).toContain("Echo: local");
    const publicPage = await app.fetch(
      new Request("http://localhost:3333/p/local-sdk"),
    );
    expect(publicPage.status).toBe(200);
    expect(await publicPage.text()).toContain("Hello from the workspace");
    await api.page.delete({ id: created.id });
    expect((await api.page.list({})).items).toHaveLength(0);

    const anonymous = createBrickClient<PagesApi>({
      baseUrl: "http://localhost:3333",
      fetch: (input, init) =>
        Promise.resolve(app.fetch(new Request(input, init))),
    });
    await expect(anonymous.page.list({})).rejects.toThrow();
  });
});

function _typeAssertions(api: ReturnType<typeof createBrickClient<PagesApi>>) {
  const echo: Promise<string> = api.pages.echo({ message: "typed" });
  // @ts-expect-error The contract requires a message string.
  api.pages.echo({ message: 123 });
  // @ts-expect-error Unknown contract actions must fail compilation.
  api.pages.missing({});
  return echo;
}
