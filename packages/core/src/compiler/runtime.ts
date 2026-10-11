import {
  ValidationError,
  ActionExecutionError,
  type CompiledRoutePlan,
} from "../types";

export type CompiledHandler = (context: any) => unknown | Promise<unknown>;
export type HandlerFactory = (
  binding: CompiledRoutePlan,
  runtime: typeof compilerRuntime,
) => CompiledHandler;

const EMPTY_SERVICES = Object.freeze({});
const DEFAULT_REQUEST = new Request("http://localhost");
let sequence = 0;

function isNonEmpty(value: any): boolean {
  if (value == null) return false;
  // Early return on the first key: an allocation-free emptiness check.
  for (const _ in value) return true; // NOSONAR
  return false;
}

/** Retains Brick's existing source precedence and treatment of empty bodies. */
function mergeInput(first: any, second: any, third: any) {
  const a = isNonEmpty(first),
    b = isNonEmpty(second),
    c = isNonEmpty(third);
  if (a && !b && !c) return first;
  if (b && !a && !c) return second;
  if (c && !a && !b) return third;
  if (a || b || c) return Object.assign({}, first, second, third);
  return undefined;
}

// Generic pre-validation nesting cap for parsed HTTP input. Compiled input
// validators recurse, so unbounded nesting (e.g. a 20k-deep filter object)
// would throw RangeError (HTTP 500) instead of failing validation with a
// 400. The walk is iterative and far above legitimate depths (a max-depth
// CRUD filter is ~45 levels of JSON).
const MAX_INPUT_DEPTH = 128;
export function inputTooDeep(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > MAX_INPUT_DEPTH) return true;
    if (node && typeof node === "object") {
      const children = Array.isArray(node) ? node : Object.values(node);
      for (const child of children)
        if (child && typeof child === "object")
          stack.push({ node: child, depth: depth + 1 });
    }
  }
  return false;
}

function checkDepth(value: unknown, action: string) {
  if (!inputTooDeep(value)) return;
  throw new ValidationError(`Validation failed for action '${action}' input`, [
    { path: "", message: "Input exceeds maximum nesting depth" },
  ]);
}

function validate(
  check: NonNullable<CompiledRoutePlan["inputChecker"]>,
  value: unknown,
  action: string,
  stage: "input" | "output",
) {
  if (check.Check(value)) return;
  const errors = Array.from(check.Errors(value)).map((err: any) => ({
    path: err.path,
    message: err.message,
    value: err.value,
  }));
  throw new ValidationError(
    `Validation failed for action '${action}' ${stage}`,
    errors,
    stage === "output" ? 500 : 400,
  );
}

function mapError(err: any, set: any) {
  if (err instanceof ValidationError || err instanceof ActionExecutionError) {
    set.status = err.status || 400;
    return err.toJSON();
  }
  set.status = 500;
  return {
    name: "InternalServerError",
    message: err?.message || "An unexpected error occurred",
    status: 500,
  };
}

export const compilerRuntime = Object.freeze({
  emptyServices: EMPTY_SERVICES,
  defaultRequest: DEFAULT_REQUEST,
  nextSequence: () => (++sequence).toString(36),
  mergeInput,
  checkDepth,
  validate,
  mapError,
  isThenable: (value: any): boolean =>
    value != null && typeof value.then === "function",
  deny: (action: string): never => {
    throw new ActionExecutionError(
      "UNAUTHORIZED",
      `Access denied for action '${action}'`,
      403,
    );
  },
});
