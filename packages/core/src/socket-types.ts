import type { Static, TSchema } from "@sinclair/typebox";

export type SocketSchemas = Record<string, TSchema>;
export type SocketPayloads<S extends SocketSchemas> = {
  [K in keyof S]: Static<S[K]>;
};
export type SocketEventArgs<Events> = {
  [K in keyof Events & string]: [event: K, payload: Events[K]];
}[keyof Events & string];

export interface BrickSocketSender<Events> {
  /** Locally accepts a message. Does not acknowledge remote delivery. */
  send(...args: SocketEventArgs<Events>): void;
  close(): void;
}

export interface BrickSocketConfig<
  I extends SocketSchemas,
  O extends SocketSchemas,
  Ctx,
> {
  name: string;
  path?: string;
  description?: string;
  input: I;
  output: O;
  /** Defaults to the upgrade request's origin. */
  allowedOrigins?: readonly string[];
  allowMissingOrigin?: boolean;
  authorize?: (params: { ctx: Ctx }) => boolean | Promise<boolean>;
  /** Rooms the connection is put in when it opens. */
  rooms?: (params: {
    ctx: Ctx;
  }) => readonly string[] | Promise<readonly string[]>;
  /** Decides each room a client asks to join. Without it, client joins are refused. */
  join?: (params: { ctx: Ctx; room: string }) => boolean | Promise<boolean>;
  /** Rooms one connection can be in at once (default 100). */
  maxRooms?: number;
  handlers: {
    [K in keyof I]: (params: {
      input: Static<I[K]>;
      ctx: Ctx;
      socket: BrickSocketSender<SocketPayloads<O>>;
    }) => void | Promise<void>;
  };
  open?: (params: {
    ctx: Ctx;
    socket: BrickSocketSender<SocketPayloads<O>>;
  }) => void | Promise<void>;
  close?: (params: {
    ctx: Ctx;
    socket: BrickSocketSender<SocketPayloads<O>>;
    code: number;
    reason: string;
  }) => void | Promise<void>;
}

export interface SocketEmitOptions {
  /** A transaction handle from `runInTransaction`: send on commit, drop on rollback. */
  after?: unknown;
}
export type SocketEmitArgs<Events> = {
  [K in keyof Events & string]: [
    event: K,
    payload: Events[K],
    options?: SocketEmitOptions,
  ];
}[keyof Events & string];

/** Returned by `service.socket()`. Emits and kicks reach every process through the app's broker. */
export interface BrickSocketHandle<Output> {
  readonly name: string;
  /** Validates and serializes once, then sends to every connection in the rooms. At most once, unacknowledged. */
  emit(
    rooms: string | readonly string[],
    ...args: SocketEmitArgs<Output>
  ): void;
  /** Removes connections from a room; `also` limits it to connections also in that room. */
  kick(room: string, options?: { also?: string; reason?: string }): void;
}

export type SocketBrokerMessage =
  | { type: "emit"; topic: string; frame: string }
  | { type: "kick"; topic: string; also?: string; reason?: string };

/** Carries emits and kicks between processes. Topics are `<service>.<socket>:<room>`. */
export interface SocketBroker {
  /** Sends to every subscriber of `message.topic`, in every process, this one included. */
  publish(message: SocketBrokerMessage): void;
  /** Called once per local holder of a topic; returns its unsubscribe. */
  subscribe(
    topic: string,
    deliver: (message: SocketBrokerMessage) => void,
  ): () => void;
  close?(): void | Promise<void>;
}

export interface BrickSocketReconnectOptions {
  /** Default 500. */
  minDelayMs?: number;
  /** Default 30 000. */
  maxDelayMs?: number;
  /** Random spread around each delay, 0 to 1. Default 0.2. */
  jitter?: number;
}

export type BrickSocketStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

export interface BrickSocketConnectOptions {
  signal?: AbortSignal;
  /** Limits each opening attempt. */
  timeoutMs?: number;
  /** Called on every connect and reconnect; sent as the `brick.token.<token>` subprotocol. */
  token?: () => string | Promise<string>;
  /** On by default. `false` ends the client at the first close. */
  reconnect?: false | BrickSocketReconnectOptions;
}

export class BrickSocketError extends Error {
  constructor(
    readonly kind: "connection" | "protocol" | "backpressure" | "refused",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BrickSocketError";
  }
}

export interface BrickSocketClient<
  Input,
  Output,
> extends BrickSocketSender<Input> {
  /** Resolves on the first open; rejects if the client closes before it. */
  readonly ready: Promise<void>;
  readonly status: BrickSocketStatus;
  onStatus(listener: (status: BrickSocketStatus) => void): () => void;
  /** After each reconnect. Messages sent while offline are not replayed. */
  onReconnect(listener: () => void): () => void;
  on<K extends keyof Output & string>(
    event: K,
    listener: (payload: Output[K]) => void,
  ): () => void;
  /** Resolves when the server accepts the room; rejects with kind `refused` otherwise. */
  join(room: string): Promise<void>;
  leave(room: string): void;
  /** The server removed this connection from a room. */
  onLeave(listener: (room: string, reason?: string) => void): () => void;
  onError(listener: (error: BrickSocketError) => void): () => void;
  onClose(
    listener: (info: { code: number; reason: string }) => void,
  ): () => void;
}

/** Browser metadata. Schemas retain TypeBox kinds as JSON-safe annotations. */
export interface BrickClientSocket<Input = unknown, Output = unknown> {
  kind: "socket";
  name: string;
  serviceName: string;
  config: { path: string };
  output: Record<string, unknown>;
  readonly __types?: { input: Input; output: Output };
}

export interface BrickSocketSchema {
  name: string;
  path?: string;
  description?: string;
  input: string[];
  output: string[];
  hasAuthorize: boolean;
}
