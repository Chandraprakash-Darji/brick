import { Effect } from "effect";
import {
  effectExecutionKey,
  effectAuthorizationKey,
  runEffectPromise,
} from "./effect-runtime";
import {
  type Service,
  type Action,
  type Logger,
  type CompiledRoutePlan,
  ValidationError,
  ActionExecutionError,
} from "./types";
import { getCompiledCheck } from "./typebox";
import { buildErrorHelpers } from "./action";
import { toErrorResponse } from "./error-response";
import { inputTooDeep } from "./compiler/runtime";

let _srvSeq = 0;
const EMPTY_SERVICES = Object.freeze({});
const DEFAULT_REQUEST = new Request("http://localhost");

function isNonEmpty(obj: any): boolean {
  if (obj == null) return false;
  // Early return on the first key: an allocation-free emptiness check.
  for (const _ in obj) return true; // NOSONAR
  return false;
}

export function compileRoutePlan(
  service: Service,
  action: Action,
  routePath: string,
  method?: string,
): CompiledRoutePlan {
  const actionName = action.name;
  const serviceName = service.name;
  const isGetLike =
    method === "GET" ||
    actionName.startsWith("get") ||
    actionName.endsWith(".get") ||
    actionName.startsWith("list") ||
    actionName.endsWith(".list") ||
    actionName.startsWith("find") ||
    actionName.startsWith("read");

  const inputSchema = action.config?.input;
  const outputSchema = action.config?.output;
  const hasInput = Boolean(inputSchema);
  const inputChecker = inputSchema
    ? (getCompiledCheck(inputSchema) as any)
    : undefined;
  // Prefer a runtime-only output schema when the action provides one (CRUD
  // subset projections validate loosely at runtime while `config.output`
  // stays strict for contracts/OpenAPI).
  const runtimeOutputSchema =
    (action as { outputValidationSchema?: typeof outputSchema })
      .outputValidationSchema ?? outputSchema;
  const outputChecker = runtimeOutputSchema
    ? (getCompiledCheck(runtimeOutputSchema) as any)
    : undefined;

  let coercions:
    | Array<{ key: string; isNumber: boolean; isBoolean: boolean }>
    | undefined;
  if (inputSchema && typeof (inputSchema as any).properties === "object") {
    const list: Array<{ key: string; isNumber: boolean; isBoolean: boolean }> =
      [];
    for (const [key, prop] of Object.entries(
      (inputSchema as any).properties,
    ) as [string, any][]) {
      const type = prop?.type;
      if (type === "number" || type === "integer") {
        list.push({ key, isNumber: true, isBoolean: false });
      } else if (type === "boolean") {
        list.push({ key, isNumber: false, isBoolean: true });
      }
    }
    if (list.length > 0) coercions = list;
  }

  const contextHook = service.options?.context;
  const hasContextHook = typeof contextHook === "function";

  const nativeAuthorize:
    | ((params: any) => Effect.Effect<boolean, unknown, any>)
    | undefined = Reflect.get(action.config, effectAuthorizationKey);
  const authorize = nativeAuthorize
    ? (params: any) =>
        runEffectPromise(
          Effect.suspend(() => nativeAuthorize(params)),
          service,
          params.ctx?.request?.signal,
        )
    : action.config?.authorize;
  const hasAuthorize = typeof authorize === "function";

  const nativeExecute = Reflect.get(action.config, effectExecutionKey);
  const execute = nativeExecute
    ? (params: any) =>
        runEffectPromise(
          Effect.suspend(() => nativeExecute(params)),
          service,
          params.ctx?.request?.signal,
        )
    : action.config?.execute;

  const tag = `[${serviceName}:${actionName}]`;
  const logger: Logger = {
    info: (...args) => console.log(tag, ...args),
    warn: (...args) => console.warn(tag, ...args),
    error: (...args) => console.error(tag, ...args),
    debug: (...args) => console.debug(tag, ...args),
  };

  const errorBuilder =
    (action as any).errorHelpers ?? buildErrorHelpers(action.config?.errors);
  const cachedDb = service.getDb();

  return {
    service,
    action,
    actionName,
    serviceName,
    routePath,
    method,
    isGetLike,
    hasInput,
    hasContextHook,
    contextHook,
    hasAuthorize,
    authorize,
    execute,
    inputChecker,
    outputChecker,
    coercions,
    logger,
    errorBuilder,
    cachedDb,
  };
}

export async function executeCompiledRoute(
  plan: CompiledRoutePlan,
  elysiaCtx: any,
) {
  const { params, body, query, headers, request, set } = elysiaCtx;
  const seq = (++_srvSeq).toString(36);
  const traceId = (headers && headers["x-trace-id"]) || `tr_${seq}`;
  const requestId = (headers && headers["x-request-id"]) || `req_${seq}`;

  if (set?.headers) {
    set.headers["x-trace-id"] = traceId;
    set.headers["x-request-id"] = requestId;
  }

  let input: any;
  if (plan.hasInput) {
    let coercedQuery = query;
    if (query && plan.coercions && plan.coercions.length > 0) {
      coercedQuery = { ...query };
      for (let i = 0; i < plan.coercions.length; i++) {
        const c = plan.coercions[i];
        const val = query[c.key];
        if (val !== undefined) {
          if (c.isNumber) {
            const num = Number(val);
            if (!isNaN(num)) coercedQuery[c.key] = num;
          } else if (c.isBoolean) {
            if (val === "true" || val === "1") coercedQuery[c.key] = true;
            else if (val === "false" || val === "0")
              coercedQuery[c.key] = false;
          }
        }
      }
    }

    const hasP = isNonEmpty(params);
    const hasB = isNonEmpty(body);
    const hasQ = isNonEmpty(coercedQuery);

    if (plan.isGetLike) {
      if (hasQ && !hasP && !hasB) {
        input = coercedQuery;
      } else if (hasP && !hasQ && !hasB) {
        input = params;
      } else if (hasB && !hasP && !hasQ) {
        input = body;
      } else if (hasQ || hasP || hasB) {
        input = Object.assign({}, coercedQuery, params, body);
      }
    } else {
      if (hasB && !hasP && !hasQ) {
        input = body;
      } else if (hasP && !hasB && !hasQ) {
        input = params;
      } else if (hasQ && !hasP && !hasB) {
        input = coercedQuery;
      } else if (hasP || hasB || hasQ) {
        input = Object.assign({}, params, body, coercedQuery);
      }
    }
  }

  const standardRequest =
    request instanceof Request ? request : DEFAULT_REQUEST;

  const ctx: any = {
    request: standardRequest,
    traceId,
    requestId,
    db: plan.cachedDb ?? plan.service.getDb(),
    logger: plan.logger,
    services: EMPTY_SERVICES,
    metadata: { headers },
    _resolved: true,
  };

  try {
    if (plan.hasContextHook) {
      const extra = plan.contextHook!(ctx);
      const resolved = extra instanceof Promise ? await extra : extra;
      if (resolved) {
        Object.assign(ctx, resolved);
      }
    }

    if (input === undefined && plan.action.config?.input?.type === "object") {
      input = {};
    }

    if (plan.hasInput && plan.inputChecker) {
      if (inputTooDeep(input)) {
        throw new ValidationError(
          `Validation failed for action '${plan.actionName}' input`,
          [{ path: "", message: "Input exceeds maximum nesting depth" }],
        );
      }
      if (!plan.inputChecker.Check(input)) {
        const errors = Array.from(plan.inputChecker.Errors(input)).map(
          (err: any) => ({
            path: err.path,
            message: err.message,
            value: err.value,
          }),
        );
        throw new ValidationError(
          `Validation failed for action '${plan.actionName}' input`,
          errors,
        );
      }
    }

    if (plan.hasAuthorize) {
      const authRes = plan.authorize!({
        ctx,
        input,
        user: ctx.user,
      });
      const isAuthorized = authRes instanceof Promise ? await authRes : authRes;
      if (!isAuthorized) {
        throw new ActionExecutionError(
          ctx.user == null ? "UNAUTHORIZED" : "FORBIDDEN",
          `Access denied for action '${plan.actionName}'`,
          ctx.user == null ? 401 : 403,
        );
      }
    }

    const execRes = plan.execute({ input, ctx, error: plan.errorBuilder });
    const result = execRes instanceof Promise ? await execRes : execRes;

    if (plan.outputChecker) {
      if (!plan.outputChecker.Check(result)) {
        const errors = Array.from(plan.outputChecker.Errors(result)).map(
          (err: any) => ({
            path: err.path,
            message: err.message,
            value: err.value,
          }),
        );
        throw new ValidationError(
          `Validation failed for action '${plan.actionName}' output`,
          errors,
          500,
        );
      }
    }

    return result;
  } catch (err) {
    const response = toErrorResponse(err, { logger: ctx.logger, requestId });
    set.status = response.status;
    return response;
  }
}

export function createActionHandler(
  service: Service,
  action: Action,
  routePath: string,
  method?: string,
) {
  const plan = compileRoutePlan(service, action, routePath, method);
  return (elysiaCtx: any) => executeCompiledRoute(plan, elysiaCtx);
}
