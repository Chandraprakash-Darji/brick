import { e2e } from "./support.js";

async function double(i: number, counterKey: string | null): Promise<number> {
  "use step";
  if (counterKey) await e2e().count(counterKey, `step:${i}`);
  return i * 2;
}

/** Scenario 1, 9, 10: Promise.all over `n` steps, each returning i * 2. */
export async function fanOut(
  n: number,
  counterKey: string | null = null,
): Promise<number> {
  "use workflow";
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) => double(i, counterKey)),
  );
  return results.reduce((a, b) => a + b, 0);
}

async function increment(value: number): Promise<number> {
  "use step";
  return value + 1;
}

/** Scenario 2: `n` strictly sequential steps. */
export async function chain(n: number): Promise<number> {
  "use workflow";
  let value = 0;
  for (let i = 0; i < n; i++) value = await increment(value);
  return value;
}

/** Scenario 9: the smallest useful run (a few steps, so the log has some shape). */
export async function tiny(seed: number): Promise<number> {
  "use workflow";
  const a = await increment(seed);
  const b = await increment(a);
  return await increment(b);
}
