import { describe, expect, test } from "bun:test";

import { hash } from "bcryptjs";

import { password } from "../src/api/auth/password";

describe("restored account password compatibility", () => {
  test("verifies legacy bcrypt passwords and rejects incorrect passwords", async () => {
    const legacyHash = await hash("legacy-password", 4);
    for (const version of ["2a", "2b", "2y"]) {
      const storedHash = legacyHash.replace(/^\$2[aby]/, `$${version}`);
      expect(
        await password.verify({
          hash: storedHash,
          password: "legacy-password",
        }),
      ).toBe(true);
      expect(
        await password.verify({ hash: storedHash, password: "wrong-password" }),
      ).toBe(false);
    }
  });

  test("new hashes use Better Auth's default format and still verify", async () => {
    const storedHash = await password.hash("new-password");
    expect(storedHash.startsWith("$2")).toBe(false);
    expect(
      await password.verify({ hash: storedHash, password: "new-password" }),
    ).toBe(true);
    expect(
      await password.verify({ hash: storedHash, password: "wrong-password" }),
    ).toBe(false);
  });

  test("rejects malformed bcrypt hashes", async () => {
    expect(
      await password.verify({ hash: "$2b$invalid", password: "anything" }),
    ).toBe(false);
  });

  test("does not accept a longer password with the same first 72 bytes", async () => {
    const original = "a".repeat(72);
    const storedHash = await hash(original, 4);
    expect(
      await password.verify({ hash: storedHash, password: original }),
    ).toBe(true);
    expect(
      await password.verify({ hash: storedHash, password: `${original}wrong` }),
    ).toBe(false);
    expect(
      await password.verify({ hash: storedHash, password: "é".repeat(37) }),
    ).toBe(false);
  });
});
