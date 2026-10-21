async function echo(blob: string): Promise<string> {
  "use step";
  return blob;
}

async function makeBlob(size: number, seed: number): Promise<string> {
  "use step";
  // Deterministic, incompressible-ish text so the test can regenerate it.
  let state = seed >>> 0 || 1;
  const chars = Array.from<string>({ length: size });
  for (let i = 0; i < size; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    chars[i] = String.fromCharCode(33 + ((state >>> 24) % 90));
  }
  return chars.join("");
}

/** Scenario 8: ~3 MB in as a step input, ~3 MB out as a step output. */
export async function bigRoundTrip(blob: string, size: number, seed: number) {
  "use workflow";
  const echoed = await echo(blob);
  const made = await makeBlob(size, seed);
  return { echoed, made };
}
