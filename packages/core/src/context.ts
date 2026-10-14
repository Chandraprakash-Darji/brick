import type { BaseContext } from "./types";

type ContextEnvelope = Pick<
  BaseContext,
  "caller" | "traceId" | "requestId" | "tenantId"
> & { user?: unknown };

export function pickContextEnvelope(
  context?: Partial<BaseContext> & { user?: unknown },
): Partial<ContextEnvelope> {
  if (!context) return {};
  const envelope: Partial<ContextEnvelope> = {};
  if (context.caller !== undefined) envelope.caller = context.caller;
  if (context.user !== undefined) envelope.user = context.user;
  if (context.traceId !== undefined) envelope.traceId = context.traceId;
  if (context.requestId !== undefined) envelope.requestId = context.requestId;
  if (context.tenantId !== undefined) envelope.tenantId = context.tenantId;
  return envelope;
}
