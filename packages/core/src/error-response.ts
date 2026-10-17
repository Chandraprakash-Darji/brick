import { ActionExecutionError, ValidationError, type Logger } from "./types";
import { recordFailure } from "./telemetry";

export interface ErrorEnvelope {
  name: string;
  code: string;
  message: string;
  status: number;
  requestId: string;
  details?: unknown;
  errors?: ValidationError["errors"];
}

type ErrorContext = { logger: Pick<Logger, "error">; requestId: string };

/** Preserve declared failures, log and wrap unexpected throws without exposing internals. */
export function normalizeActionError(
  err: unknown,
  { logger, requestId }: ErrorContext,
): ActionExecutionError | ValidationError {
  if (err instanceof ActionExecutionError || err instanceof ValidationError)
    return err;
  logger.error("Unexpected action error", { requestId }, err);
  const failure = new ActionExecutionError(
    "INTERNAL_SERVER_ERROR",
    "Internal Server Error",
    500,
    undefined,
    { cause: err },
  );
  failure.name = "InternalServerError";
  return failure;
}

export function toErrorResponse(
  err: unknown,
  context: ErrorContext,
): ErrorEnvelope {
  const envelope = buildErrorEnvelope(err, context);
  recordFailure(err, envelope);
  return envelope;
}

function buildErrorEnvelope(
  err: unknown,
  context: ErrorContext,
): ErrorEnvelope {
  const failure = normalizeActionError(err, context);
  if (
    failure.status >= 500 &&
    (err instanceof ActionExecutionError || err instanceof ValidationError)
  ) {
    context.logger.error(
      "Server action error",
      { requestId: context.requestId },
      err,
    );
  }
  if (failure instanceof ValidationError && failure.status >= 500) {
    return {
      name: failure.name,
      code: failure.code,
      message: failure.message,
      status: failure.status,
      requestId: context.requestId,
    };
  }
  return { ...failure.toJSON(), requestId: context.requestId };
}
