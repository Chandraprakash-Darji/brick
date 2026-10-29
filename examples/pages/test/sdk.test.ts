import { describe, expect, it } from "bun:test";
import { createBrickClient } from "@brickkit/core/client";

import { buildApp } from "../src/api/app";
import { getAuth } from "../src/api/auth";
import type { AppContract as PagesApi } from "../_brick/contract";
import { generateClientContract } from "@brickkit/cli";
import { appDb, appSql } from "../src/api/db";
import { prepareTestDatabase } from "./database";

// The client contract is generated from the live app after the test database
// is prepared: building earlier would compile against a handle that another
// test file's app teardown may already have closed.
const contractFile = new URL("../_brick/contract.ts", import.meta.url);

async function loadContract() {
  await Bun.write(contractFile, generateClientContract(buildApp()));
  return (await import(contractFile.href)).contract;
}

describe("local Brick SDK", () => {
  it("reuses the app-owned postgres client", () => {
    expect(appDb.getDb().$client).toBe(appSql);
  });

  it("authenticates and performs CRUD through the real pages app", async () => {
    await prepareTestDatabase();
    const contract = await loadContract();
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
      contract,
      baseUrl: "http://localhost:3333",
      headers: { cookie: cookie! },
      fetch: (input, init) =>
        Promise.resolve(app.fetch(new Request(input, init))),
    });
    const created = await api.pages.page.create({
      title: "Local SDK",
      slug: "local-sdk",
      content: "# Hello from the workspace",
      contentType: "markdown",
      isPublic: true,
    });
    expect(created.userId).toBeDefined();
    expect(created.contentType).toBe("markdown");
    expect((await api.pages.page.list({ limit: 100 })).items).toHaveLength(1);
    expect((await api.pages.page.get({ id: created.id })).content).toContain(
      "workspace",
    );
    expect(
      (
        await api.pages.page.update({
          id: created.id,
          data: { title: "Updated" },
        })
      ).title,
    ).toBe("Updated");
    expect(await api.pages.echo({ message: "local" })).toContain("Echo: local");
    const publicPage = await app.fetch(
      new Request("http://localhost:3333/p/local-sdk"),
    );
    expect(publicPage.status).toBe(200);
    expect(await publicPage.text()).toContain("Hello from the workspace");
    await api.pages.page.delete({ id: created.id });
    expect((await api.pages.page.list({})).items).toHaveLength(0);

    const anonymous = createBrickClient<PagesApi>({
      contract,
      baseUrl: "http://localhost:3333",
      fetch: (input, init) =>
        Promise.resolve(app.fetch(new Request(input, init))),
    });
    await expect(anonymous.pages.page.list({})).rejects.toThrow();
  });
});

function _typeAssertions(api: ReturnType<typeof createBrickClient<PagesApi>>) {
  const echo: Promise<string> = api.pages.echo({ message: "typed" });
  // @ts-expect-error The contract requires a message string.
  api.pages.echo({ message: 123 });
  // @ts-expect-error Unknown contract actions must fail compilation.
  api.pages.missing({});
  const created = api.pages.page.create({
    title: "Typed",
    slug: "typed",
    content: "Body",
  });
  // @ts-expect-error CRUD inputs must be required.
  api.pages.page.create();
  // @ts-expect-error CRUD inputs must retain required columns.
  api.pages.page.create({ title: "Typed" });
  // @ts-expect-error CRUD inputs must retain column types.
  api.pages.page.create({ title: 123, slug: "typed", content: "Body" });
  api.pages.page.create({
    title: "Typed",
    slug: "typed",
    content: "Body",
    // @ts-expect-error Owners are assigned on the server.
    userId: "forged",
  });
  // @ts-expect-error CRUD output must be typed too.
  created.then((page) => page.missing);
  return { echo, created };
}
