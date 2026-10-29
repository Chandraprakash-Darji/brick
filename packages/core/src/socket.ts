import type { Elysia } from "elysia";
import { websocket } from "elysia/websocket";
import { createLogger } from "./logger";
import { joinRoute, kebabCase, legacyPath, ownerPath } from "./routes";
import type { BaseContext } from "./types";
import { getCompiledCheck } from "./typebox";
import {
  serializeSocketSchema,
  isSocketEnvelope,
  SOCKET_MAX_BYTES,
  SOCKET_BUFFER_BYTES,
} from "./socket-schema";
import type {
  BrickSocketConfig,
  BrickSocketSchema,
  BrickSocketSender,
  SocketPayloads,
  SocketSchemas,
} from "./socket-types";

interface SocketSender {
  readonly isOpen: boolean;
  send(event: string, payload: unknown): void;
  close(): void;
}
interface SocketSession {
  open(socket: SocketSender): Promise<void>;
  message(event: string, data: unknown, socket: SocketSender): Promise<void>;
  close(socket: SocketSender, code: number, reason: string): Promise<void>;
}
export interface RegisteredSocket {
  schema: BrickSocketSchema;
  input: SocketSchemas;
  output: SocketSchemas;
  allowedOrigins?: readonly string[];
  allowMissingOrigin?: boolean;
  connect(request: Request): Promise<SocketSession>;
}

class SocketDenied extends Error {}

export function defineServiceSocket<
  I extends SocketSchemas,
  O extends SocketSchemas,
  Ctx extends BaseContext,
>(
  config: BrickSocketConfig<I, O, Ctx>,
  resolve: (request: Request) => Promise<Ctx>,
): RegisteredSocket {
  if (
    !config.name ||
    config.name.split(".").some((part) => !/^[a-zA-Z_][\w-]*$/.test(part))
  )
    throw new Error("Invalid socket name");
  if (
    config.path !== undefined &&
    (!config.path.startsWith("/") ||
      /[?#*]/.test(config.path) ||
      config.path.split("/").some((segment) => segment.startsWith(":")))
  )
    throw new Error(
      "Socket path must be a static route (relative to its service) without a query or fragment",
    );
  const input = Object.freeze({ ...config.input });
  const output = Object.freeze({ ...config.output });
  const handlers = { ...config.handlers };
  if (
    Object.keys(input).length !== Object.keys(handlers).length ||
    Object.keys(input).some(
      (key) =>
        !Object.hasOwn(handlers, key) || typeof handlers[key] !== "function",
    )
  )
    throw new Error("Every socket input event needs exactly one handler");
  for (const schema of [...Object.values(input), ...Object.values(output)]) {
    serializeSocketSchema(schema);
    getCompiledCheck(schema);
  }
  const typed = (socket: SocketSender): BrickSocketSender<SocketPayloads<O>> =>
    socket;
  const context = async (request: Request) => {
    const ctx = await resolve(request);
    if (config.authorize && !(await config.authorize({ ctx })))
      throw new SocketDenied();
    return ctx;
  };
  return {
    schema: {
      name: config.name,
      path: config.path,
      description: config.description,
      input: Object.keys(input),
      output: Object.keys(output),
      hasAuthorize: !!config.authorize,
    },
    input,
    output,
    allowedOrigins: config.allowedOrigins
      ? [...config.allowedOrigins]
      : undefined,
    allowMissingOrigin: config.allowMissingOrigin,
    async connect(request) {
      const initial = await context(request);
      return {
        async open(socket) {
          await config.open?.({ ctx: initial, socket: typed(socket) });
        },
        async message(event, data, socket) {
          const schema = Object.hasOwn(input, event) ? input[event] : undefined;
          if (!schema || !getCompiledCheck(schema).Check(data))
            throw new SocketDenied();
          const ctx = await context(request);
          if (!socket.isOpen) return;
          // The schema and event were checked together before dispatch.
          const handler = handlers[event as keyof I];
          await handler({
            input: data as SocketPayloads<I>[keyof I],
            ctx,
            socket: typed(socket),
          });
        },
        async close(socket, code, reason) {
          await config.close?.({
            ctx: initial,
            socket: typed(socket),
            code,
            reason,
          });
        },
      };
    },
  };
}

/** `${prefix}/${service}/${socket}`; an explicit path is relative to the service. */
export function socketPath(
  prefix: string,
  service: string,
  socket: RegisteredSocket,
): string {
  return joinRoute(
    ownerPath(prefix, service),
    socket.schema.path ?? `/${kebabCase(socket.schema.name)}`,
  );
}

/** The v0.10 route, served too by `brick({ legacyRoutes: true })`. */
export function legacySocketPath(
  prefix: string,
  service: string,
  socket: RegisteredSocket,
): string | undefined {
  return legacyPath(prefix, service, socket.schema.name, socket.schema.path);
}

/** The origin a browser saw, so TLS-terminating proxies still pass the same-origin check. */
function publicOrigin(request: Request): string {
  // Browsers cannot set X-Forwarded-* on a WebSocket handshake, so a cross-site page cannot forge a match.
  const forwarded = (name: string) =>
    request.headers.get(name)?.split(",")[0]?.trim() || undefined;
  const url = new URL(request.url);
  const proto = forwarded("x-forwarded-proto");
  return `${proto ? `${proto}:` : url.protocol}//${forwarded("x-forwarded-host") ?? url.host}`;
}

/** Mounts native adapters. Each connection owns its queue and service session. */
export function mountSockets(
  app: Elysia,
  sockets: { service: string; path: string; definition: RegisteredSocket }[],
): void {
  if (!sockets.length) return;
  app.use(
    websocket({
      maxPayloadLength: SOCKET_MAX_BYTES,
      backpressureLimit: SOCKET_BUFFER_BYTES,
      closeOnBackpressureLimit: true,
    }),
  );
  for (const { service, path, definition } of sockets) {
    const logger = createLogger(
      `[Brick socket ${service}.${definition.schema.name}]`,
    );
    const sessions = new WeakMap<Request, SocketSession>();
    type Peer = {
      request: Request;
      send(data: string): number;
      close(code?: number, reason?: string): void;
      readonly readyState: number;
    };
    const connections = new WeakMap<
      Request,
      {
        session: SocketSession;
        sender: SocketSender;
        tail: Promise<void>;
        pending: number;
        bytes: number;
        closed: boolean;
      }
    >();
    const fail = (ws: Peer, error: unknown) => {
      if (!(error instanceof SocketDenied))
        logger.error({ error, service, socket: definition.schema.name });
      if (ws.readyState !== 1) return;
      ws.close(
        error instanceof SocketDenied ? 1008 : 1011,
        error instanceof SocketDenied
          ? "Message refused"
          : "Socket handler failed",
      );
    };
    app.ws(path, {
      async beforeHandle({ request }) {
        if (sessions.has(request)) return;
        const origin = request.headers.get("origin");
        if (
          origin
            ? !(definition.allowedOrigins ?? [publicOrigin(request)]).includes(
                origin,
              )
            : !definition.allowMissingOrigin
        )
          return new Response("Socket origin refused", { status: 403 });
        try {
          sessions.set(request, await definition.connect(request));
        } catch (error) {
          if (!(error instanceof SocketDenied))
            logger.error({ error, service, socket: definition.schema.name });
          return new Response("Socket connection refused", {
            status: error instanceof SocketDenied ? 403 : 500,
          });
        }
      },
      async open(ws) {
        const session = sessions.get(ws.request);
        if (!session) {
          ws.close(1011, "Missing socket session");
          return;
        }
        const sender: SocketSender = {
          get isOpen() {
            return !state.closed && ws.readyState === 1;
          },
          close() {
            ws.close(1000, "");
          },
          send(event, data) {
            if (!sender.isOpen) throw new Error("Socket is closed");
            const schema = Object.hasOwn(definition.output, event)
              ? definition.output[event]
              : undefined;
            if (!schema || !getCompiledCheck(schema).Check(data))
              throw new Error("Invalid socket output");
            const frame = JSON.stringify({ event, data });
            if (new TextEncoder().encode(frame).byteLength > SOCKET_MAX_BYTES)
              throw new Error("Socket output too large");
            // Check the JSON representation too, so values lost during serialization cannot break the contract.
            if (!getCompiledCheck(schema).Check(JSON.parse(frame).data))
              throw new Error("Socket output is not JSON-compatible");
            const result = ws.send(frame);
            if (result === 0) {
              ws.close(1013, "Socket buffer full");
              throw new Error("Socket buffer full");
            }
          },
        };
        const state = {
          session,
          sender,
          tail: Promise.resolve(),
          pending: 0,
          bytes: 0,
          closed: false,
        };
        connections.set(ws.request, state);
        try {
          await session.open(sender);
        } catch (error) {
          fail(ws, error);
        }
      },
      message(ws, value: unknown) {
        const state = connections.get(ws.request);
        if (!state || state.closed || ws.readyState !== 1) return;
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
          ws.close(1003, "Only JSON text is supported");
          return;
        }
        if (typeof value === "string") {
          ws.close(1007, "Expected JSON envelope");
          return;
        }
        if (!isSocketEnvelope(value)) {
          ws.close(1008, "Invalid socket envelope");
          return;
        }
        const size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
        if (size > SOCKET_MAX_BYTES) {
          ws.close(1009, "Message too large");
          return;
        }
        if (state.pending >= 32 || state.bytes + size > SOCKET_BUFFER_BYTES) {
          ws.close(1013, "Socket queue full");
          return;
        }
        state.pending++;
        state.bytes += size;
        state.tail = state.tail
          .then(async () => {
            if (state.closed || ws.readyState !== 1) return;
            await state.session.message(value.event, value.data, state.sender);
          })
          .catch((error: unknown) => fail(ws, error))
          .finally(() => {
            state.pending--;
            state.bytes -= size;
          });
        // Brick owns the queue. Returning the tail here makes native close wait on application work.
      },
      async close(ws, code = 1006, reason = "") {
        const state = connections.get(ws.request);
        sessions.delete(ws.request);
        if (!state || state.closed) return;
        state.closed = true;
        try {
          await state.session.close(state.sender, code, reason);
        } catch (error) {
          logger.error({
            error,
            service,
            socket: definition.schema.name,
            phase: "cleanup",
          });
        }
        connections.delete(ws.request);
      },
    });
  }
}
