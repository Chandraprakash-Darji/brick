import { FatalError, getStepMetadata, RetryableError } from "workflow";

async function flaky(): Promise<{ attempt: number }> {
  "use step";
  const { attempt } = getStepMetadata();
  if (attempt < 3) {
    throw new RetryableError(`not yet (attempt ${attempt})`, {
      retryAfter: 1000,
    });
  }
  return { attempt };
}

/** Scenario 4: RetryableError on attempts 1 and 2, success on 3. */
export async function retryThenSucceed() {
  "use workflow";
  return await flaky();
}

async function explode(message: string): Promise<never> {
  "use step";
  throw new FatalError(message);
}

/** Scenario 5: an uncaught FatalError from a step fails the run. */
export async function fatal(message: string) {
  "use workflow";
  await explode(message);
  return "unreachable";
}
