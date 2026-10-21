/** Handles for the fixture workflows (test/e2e/workflows/*.ts), as the server's /invoke names them. */
export interface WorkflowRef {
  file: string;
  workflow: string;
}

const ref = (file: string, workflow: string): WorkflowRef => ({
  file: `workflows/${file}.ts`,
  workflow,
});

export const W = {
  fanOut: ref("fanout", "fanOut"),
  chain: ref("fanout", "chain"),
  tiny: ref("fanout", "tiny"),
  sleepThenStep: ref("sleepy", "sleepThenStep"),
  sleepyRun: ref("sleepy", "sleepyRun"),
  slowStep: ref("sleepy", "slowStep"),
  retryThenSucceed: ref("errors", "retryThenSucceed"),
  fatal: ref("errors", "fatal"),
  waitForHook: ref("hooks", "waitForHook"),
  claimHook: ref("hooks", "claimHook"),
  awaitHookDirectly: ref("hooks", "awaitHookDirectly"),
  collectHook: ref("hooks", "collectHook"),
  streamChunks: ref("streams", "streamChunks"),
  bigRoundTrip: ref("payloads", "bigRoundTrip"),
} as const;
