import { Effect, Schema, SchemaAST, SchemaGetter } from "effect";
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api";
import { Rpc } from "effect/rpc";
import { Tool } from "effect/ai";
import type { HttpMethod } from "effect/http/HttpMethod";

const redactedDefect = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.Unknown, {
    decode: SchemaGetter.transform(() => new Error("Internal server error")),
    encode: SchemaGetter.transform(() => ({
      message: "Internal server error",
    })),
  }),
);

const errorWrapper = <E extends Schema.Top>(error: E) =>
  Schema.Union([error]).annotate({
    httpApiStatus:
      SchemaAST.resolveAt<number>("httpApiStatus")(error.ast) ?? 500,
  });
export const action = <
  const N extends string,
  I extends Schema.Top,
  O extends Schema.Top,
  const Errors extends readonly Schema.Top[],
>(
  name: N,
  path: `/${string}`,
  schemas: {
    input: I;
    output: O;
    errors: Errors;
    mcp?: boolean;
    description?: string;
    title?: string;
    tool?: {
      readonly readOnly?: boolean;
      readonly destructive?: boolean;
      readonly idempotent?: boolean;
      readonly openWorld?: boolean;
    };
  },
) => {
  const errors = schemas.errors.map((error) => errorWrapper(error));
  const typedEndpoint = HttpApiEndpoint.post(name, path, {
    payload: schemas.input,
    success: schemas.output,
    error: Schema.Union([Schema.Union(schemas.errors)]),
  });
  // Native private ErrorNoStream cannot reduce arrays with open schema members.
  // Mapping the identical error schemas preserves all Type/EncodingServices slots.
  let endpoint = HttpApiEndpoint.post(name, path, {
    payload: schemas.input,
    success: schemas.output,
    error: errors,
  }) as unknown as typeof typedEndpoint;
  if (schemas.description)
    endpoint = endpoint.annotate(OpenApi.Description, schemas.description);
  if (schemas.title)
    endpoint = endpoint.annotate(OpenApi.Summary, schemas.title);
  let tool = Tool.make(name, {
    parameters: schemas.input,
    success: schemas.output,
    failure: Schema.Union(schemas.errors),
    description: schemas.description,
  });
  if (schemas.title) tool = tool.annotate(Tool.Title, schemas.title);
  if (schemas.tool?.readOnly !== undefined)
    tool = tool.annotate(Tool.Readonly, schemas.tool.readOnly);
  if (schemas.tool?.destructive !== undefined)
    tool = tool.annotate(Tool.Destructive, schemas.tool.destructive);
  if (schemas.tool?.idempotent !== undefined)
    tool = tool.annotate(Tool.Idempotent, schemas.tool.idempotent);
  if (schemas.tool?.openWorld !== undefined)
    tool = tool.annotate(Tool.OpenWorld, schemas.tool.openWorld);
  const contract = Object.freeze({
    name,
    endpoint,
    method: "POST" as HttpMethod,
    path,
    rpc: Rpc.make(name, {
      payload: schemas.input,
      success: schemas.output,
      error: Schema.Union(schemas.errors),
      defect: redactedDefect,
    }),
    tool,
    mcp: schemas.mcp === true,
  });
  const implement = <Failure extends Errors[number]["Type"], R>(
    handler: (input: I["Type"]) => Effect.Effect<O["Type"], Failure, R>,
  ) => {
    const invoke = (input: I["Type"]) =>
      handler(input).pipe(Effect.withSpan(`brick.action.${name}`));
    return Object.freeze({
      ...contract,
      handler: invoke,
      httpHandler: ({ payload }: { payload: I["Type"] }) => invoke(payload),
    });
  };
  Object.defineProperty(implement, "name", {
    value: name,
    writable: true,
    configurable: true,
  });
  return Object.freeze(Object.assign(implement, contract));
};

type HttpInputKey = "params" | "query" | "payload" | "headers";
type Part<I, K extends HttpInputKey> = K extends keyof I ? I[K] : never;

type ParamCodec<S> = [S] extends [never]
  ? never
  : S extends Schema.Top
    ? Schema.toCodecStringTree<S>
    : never;

type PayloadCodec<S> = [S] extends [never]
  ? never
  : S extends Schema.Top
    ? Schema.toCodecJson<S>
    : never;

type SuccessCodec<S> = [S] extends [never]
  ? typeof HttpApiSchema.NoContent
  : S extends Schema.Top
    ? Schema.toCodecJson<S>
    : never;

type ErrorCodec<E extends readonly Schema.Top[]> = [E] extends [never]
  ? never
  : Schema.toCodecJson<Schema.Union<[Schema.Union<E>]>>;

/** Typed HTTP request parts also form the input contract for local/RPC/tool calls. */
export const endpoint = <
  const N extends string,
  const M extends HttpMethod,
  const I extends Record<string, Schema.Top>,
  O extends Schema.Top,
  const Errors extends readonly Schema.Top[],
>(
  name: N,
  method: M,
  path: `/${string}`,
  schemas: {
    readonly input: I &
      Record<Exclude<keyof I, HttpInputKey>, never> &
      (M extends HttpMethod.NoBody ? { readonly payload?: never } : unknown);
    readonly output: O;
    readonly errors: Errors;
    readonly mcp?: boolean;
    readonly description?: string;
    readonly title?: string;
  },
) => {
  const requestSchema = Schema.Struct(schemas.input);
  const base = action(name, path, { ...schemas, input: requestSchema });
  const parts = schemas.input;
  const endpointOptions = {
    ...(parts.params !== undefined
      ? { params: parts.params as Part<I, "params"> }
      : {}),
    ...(parts.query !== undefined
      ? { query: parts.query as Part<I, "query"> }
      : {}),
    ...(parts.payload !== undefined
      ? {
          payload: parts.payload as Part<I, "payload"> &
            HttpApiEndpoint.PayloadConstraintCodecs<M>,
        }
      : {}),
    ...(parts.headers !== undefined
      ? { headers: parts.headers as Part<I, "headers"> }
      : {}),
    success: schemas.output,
    error: Schema.Union([Schema.Union(schemas.errors)]),
  };
  const typed = (HttpApiEndpoint.make(method) as any)(
    name,
    path,
    endpointOptions,
  ) as HttpApiEndpoint.HttpApiEndpoint<
    N,
    M,
    `/${string}`,
    ParamCodec<Part<I, "params">>,
    ParamCodec<Part<I, "query">>,
    PayloadCodec<Part<I, "payload">>,
    ParamCodec<Part<I, "headers">>,
    SuccessCodec<O>,
    ErrorCodec<Errors>
  >;

  const http = (HttpApiEndpoint.make(method) as any)(name, path, {
    ...(parts.params !== undefined ? { params: parts.params } : {}),
    ...(parts.query !== undefined ? { query: parts.query } : {}),
    ...(parts.payload !== undefined ? { payload: parts.payload } : {}),
    ...(parts.headers !== undefined ? { headers: parts.headers } : {}),
    success: schemas.output,
    error: schemas.errors.map(errorWrapper),
  }) as unknown as typeof typed;
  const metadata = {
    ...base,
    name,
    method: method as HttpMethod,
    endpoint: http,
  };
  const implement = <Failure extends Errors[number]["Type"], R>(
    handler: (
      input: typeof requestSchema.Type,
    ) => Effect.Effect<O["Type"], Failure, R>,
  ) => {
    const implemented = base(handler);
    return Object.freeze({
      ...implemented,
      method: method as HttpMethod,
      endpoint: http,
      httpHandler: implemented.handler,
    });
  };
  Object.defineProperty(implement, "name", {
    value: name,
    writable: true,
    configurable: true,
  });
  return Object.freeze(Object.assign(implement, metadata));
};
