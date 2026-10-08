import { compare, truncates } from "bcryptjs";
import { hashPassword, verifyPassword } from "better-auth/crypto";

// Keep Better Auth's default format for new passwords; the restored Go
// accounts retain their bcrypt hashes until their passwords are changed.
export const password = {
  hash: hashPassword,
  async verify(input: { hash: string; password: string }): Promise<boolean> {
    if (input.hash.startsWith("$2")) {
      if (
        !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(input.hash) ||
        truncates(input.password)
      ) {
        return false;
      }
      return compare(input.password, input.hash);
    }
    return verifyPassword(input);
  },
};
