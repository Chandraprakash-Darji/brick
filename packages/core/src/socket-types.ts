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

export interface BrickSocketConnectOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class BrickSocketError extends Error {
  constructor(
    readonly kind: "connection" | "protocol" | "backpressure",
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
  readonly ready: Promise<void>;
  on<K extends keyof Output & string>(
    event: K,
    listener: (payload: Output[K]) => void,
  ): () => void;
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
