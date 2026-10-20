import { expect, it } from "bun:test";
import type { Step, WorkflowRun } from "@workflow/web-shared";
import { mapRunToExecution } from "../app/lib/flow-graph/graph-execution-mapper";
import { readSerializedError } from "../app/lib/flow-graph/serialized-error";
import type { WorkflowGraph } from "../app/lib/flow-graph/workflow-graph-types";

it("normalizes unknown step errors without trusting serialized fields", () => {
  const date = new Date(0);
  const run: WorkflowRun = {
    runId: "run",
    deploymentId: "deployment",
    workflowName: "workflow",
    status: "running",
    attributes: {},
    createdAt: date,
    updatedAt: date,
  };
  for (const nodeKind of ["step", "tool"] as const) {
    const graph: WorkflowGraph = {
      workflowId: "workflow",
      workflowName: "workflow",
      filePath: "workflow.ts",
      edges: [],
      nodes: [
        {
          id: "node",
          type: nodeKind,
          position: { x: 0, y: 0 },
          data: { nodeKind, label: "fail", stepId: "step//workflow.ts//fail" },
        },
      ],
    };
    for (const [error, message] of [
      ["failed", "failed"],
      [null, undefined],
      [{}, "Unknown error"],
      [{ message: 42 }, "Unknown error"],
      [{ message: "failed", stack: {}, code: 500 }, "failed"],
    ] as const) {
      const step: Step = {
        runId: run.runId,
        stepId: "step",
        stepName: "step//workflow.ts//fail",
        status: "failed",
        attempt: 1,
        createdAt: date,
        updatedAt: date,
        error,
      };
      const mapped = mapRunToExecution(run, [step], [], graph);
      const executions = mapped.nodeExecutions.get("node");
      expect(executions?.length).toBeGreaterThan(0);
      for (const execution of executions ?? []) {
        expect(execution.error?.message).toBe(message);
        expect(execution.error?.code).toBeUndefined();
        expect([undefined, ""]).toContain(execution.error?.stack);
      }
    }
  }

  expect(readSerializedError(null)).toBeUndefined();
  expect(readSerializedError(undefined)).toBeUndefined();
  expect(readSerializedError("failed")).toEqual({ message: "failed" });
  expect(readSerializedError({})).toEqual({ message: "Unknown error" });
  expect(readSerializedError(42)).toEqual({ message: "Unknown error" });
  expect(
    readSerializedError({ message: "failed", stack: {}, code: 500 }),
  ).toEqual({ message: "failed" });
  expect(readSerializedError({ message: null })).toEqual({
    message: "Unknown error",
  });
  expect(
    readSerializedError({
      message: "failed",
      stack: "trace",
      code: "E_FAILED",
    }),
  ).toEqual({ message: "failed", stack: "trace", code: "E_FAILED" });
});
