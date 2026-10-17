import { expect } from "vitest";

// Fulfilled entries are ignored; callers assert their own count separately.
export function expectRejectedWith(
  results: readonly PromiseSettledResult<unknown>[],
  errorName: string,
): void {
  for (const result of results) {
    if (result.status === "rejected") {
      expect(result.reason).toMatchObject({ name: errorName });
    }
  }
}
