import { describe, expect, test } from "bun:test";
import { prepareTestDatabase, testPassword } from "./database";
import { hash } from "bcryptjs";
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite("scoped better-auth and request identity", () => {
  test("signs in, rejects invalid passwords, preserves bcrypt accounts and request isolation", async () => {
    const db = await prepareTestDatabase();
    try {
      const owner = await db.signup("auth@example.com");
      const signin = await db.request("/api/auth/sign-in/email", {
        email: "auth@example.com",
        password: testPassword,
      });
      expect(signin.status).toBe(200);
      expect(signin.headers.get("set-cookie")).toContain(
        "better-auth.session_token",
      );
      expect(
        (
          await db.request("/api/auth/sign-in/email", {
            email: "auth@example.com",
            password: "wrong-password",
          })
        ).status,
      ).toBe(401);
      const legacy = await hash("legacy-password", 4);
      await db.sql`update account set password=${legacy} where user_id=${owner.body.user.id}`;
      expect(
        (
          await db.request("/api/auth/sign-in/email", {
            email: "auth@example.com",
            password: "legacy-password",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await db.sql`select password from account where user_id=${owner.body.user.id}`
        )[0]?.password,
      ).toBe(legacy);
      const [authed, anonymous] = await Promise.all([
        db.request("/api/pages/echo", { message: "ok" }, owner.cookie),
        db.request("/api/pages/echo", { message: "no" }),
      ]);
      expect(authed.status).toBe(200);
      expect(anonymous.status).toBe(401);
      expect(await authed.json()).toContain(owner.body.user.id);
    } finally {
      await db.close();
    }
  }, 30000);
});
