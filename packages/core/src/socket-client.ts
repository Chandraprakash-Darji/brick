import { Check } from "@sinclair/typebox/value";
import {
  isSocketEnvelope,
  isSocketRoom,
  restoreSocketSchema,
  SOCKET_BUFFER_BYTES,
  SOCKET_MAX_BYTES,
} from "./socket-schema";
import {
  BrickSocketError,
  type BrickClientSocket,
  type BrickSocketClient,
  type BrickSocketConnectOptions,
} from "./socket-types";

export function connectSocket(
  baseUrl: string,
  contract: BrickClientSocket,
  options: BrickSocketConnectOptions,
): BrickSocketClient<Record<string, unknown>, Record<string, unknown>> {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}${contract.config.path}`);
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol))
    throw new Error("Invalid socket URL protocol");
  url.protocol =
    url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  if (url.search || url.hash)
    throw new Error("Socket base URL must not contain a query or fragment");
  const schemas = new Map(
    Object.entries(contract.output).map(([name, schema]) => [
      name,
      restoreSocketSchema(schema),
    ]),
  );
  const events = new Map<string, Set<(value: unknown) => void>>();
  const errors = new Set<(error: BrickSocketError) => void>();
  const closes = new Set<(info: { code: number; reason: string }) => void>();
  const leaves = new Set<(room: string, reason?: string) => void>();
  const joins = new Map<string, PromiseWithResolvers<void>[]>();
  let resolveReady!: () => void;
  let rejectReady!: (reason: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Consumers can register lifecycle listeners without awaiting ready.
  void ready.catch(() => {});
  let opened = false;
  let finished = false;
  let ws: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const signal = options.signal;
  const report = (error: BrickSocketError) => {
    for (const listener of errors) listener(error);
  };
  const finish = (info: { code: number; reason: string }, error?: unknown) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (ws) {
      ws.onopen = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.onclose = null;
    }
    if (!opened)
      rejectReady(
        error ??
          new BrickSocketError("connection", "Socket closed before opening"),
      );
    for (const pending of [...joins.values()].flat())
      pending.reject(
        new BrickSocketError("connection", "Socket closed before joining"),
      );
    joins.clear();
    try {
      for (const listener of closes) listener(info);
    } finally {
      events.clear();
      errors.clear();
      closes.clear();
      leaves.clear();
    }
  };
  const stop = (error?: unknown, code = 1000, reason = "") => {
    if (finished) return;
    try {
      if (error instanceof BrickSocketError) report(error);
    } finally {
      try {
        ws?.close(code, reason);
      } finally {
        finish({ code, reason }, error);
      }
    }
  };
  /** Checks a room acknowledgement or removal; returns the work to run once it passed. */
  const control = (event: string, data: unknown): (() => void) => {
    const fields = (data ?? {}) as Record<string, unknown>;
    const room = fields.room;
    if (!isSocketRoom(room)) throw new Error("Invalid control message");
    if (event === "$join" && typeof fields.ok === "boolean")
      return () => {
        const pending = joins.get(room) ?? [];
        joins.delete(room);
        for (const { resolve, reject } of pending)
          if (fields.ok) resolve();
          else reject(new BrickSocketError("refused", `Join refused: ${room}`));
      };
    if (event === "$left") {
      const reason =
        typeof fields.reason === "string" ? fields.reason : undefined;
      return () => {
        for (const listener of leaves) listener(room, reason);
      };
    }
    if (event === "$leave") return () => {};
    throw new Error("Unknown control message");
  };
  const abort = () =>
    stop(signal?.reason ?? new DOMException("Aborted", "AbortError"));
  const write = (event: string, data: unknown) => {
    if (!ws || !opened || finished || ws.readyState !== 1)
      throw new BrickSocketError("connection", "Socket is not open");
    ws.send(JSON.stringify({ event, data }));
  };
  const api: BrickSocketClient<
    Record<string, unknown>,
    Record<string, unknown>
  > = {
    ready,
    join(room) {
      if (!isSocketRoom(room))
        return Promise.reject(
          new BrickSocketError("protocol", `Invalid room: ${String(room)}`),
        );
      const pending = Promise.withResolvers<void>();
      try {
        write("$join", { room });
      } catch (error) {
        return Promise.reject(error);
      }
      joins.set(room, [...(joins.get(room) ?? []), pending]);
      return pending.promise;
    },
    leave(room) {
      if (isSocketRoom(room) && ws?.readyState === 1 && !finished)
        write("$leave", { room });
    },
    onLeave(listener) {
      if (!finished) leaves.add(listener);
      return () => {
        leaves.delete(listener);
      };
    },
    send(event, data) {
      if (!ws || !opened || finished || ws.readyState !== 1)
        throw new BrickSocketError("connection", "Socket is not open");
      if (event.startsWith("$"))
        throw new BrickSocketError("protocol", "Reserved socket event");
      const frame = JSON.stringify({ event, data });
      const bytes = new TextEncoder().encode(frame).byteLength;
      if (!isSocketEnvelope(JSON.parse(frame)) || bytes > SOCKET_MAX_BYTES)
        throw new BrickSocketError(
          "protocol",
          "Message must be a JSON payload under 64 KiB",
        );
      if (ws.bufferedAmount + bytes > SOCKET_BUFFER_BYTES) {
        const error = new BrickSocketError(
          "backpressure",
          "Socket buffer full",
        );
        stop(error, 4001, "Socket buffer full");
        throw error;
      }
      ws.send(frame);
    },
    close() {
      stop();
    },
    on(event, listener) {
      if (finished) return () => {};
      const listeners = events.get(event) ?? new Set();
      listeners.add(listener);
      events.set(event, listeners);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) events.delete(event);
      };
    },
    onError(listener) {
      if (!finished) errors.add(listener);
      return () => {
        errors.delete(listener);
      };
    },
    onClose(listener) {
      if (!finished) closes.add(listener);
      return () => {
        closes.delete(listener);
      };
    },
  };
  if (
    options.timeoutMs !== undefined &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
  )
    throw new Error("Socket timeoutMs must be a finite nonnegative number");
  if (signal?.aborted) {
    queueMicrotask(abort);
    return api;
  }
  try {
    ws = new WebSocket(url);
  } catch (cause) {
    queueMicrotask(() =>
      stop(
        new BrickSocketError("connection", "Socket connection failed", {
          cause,
        }),
      ),
    );
    return api;
  }
  ws.onopen = () => {
    if (finished) return;
    opened = true;
    clearTimeout(timer);
    resolveReady();
  };
  ws.onerror = () =>
    stop(new BrickSocketError("connection", "Socket connection failed"));
  ws.onclose = ({ code, reason }) => finish({ code, reason });
  ws.onmessage = ({ data }: MessageEvent<unknown>) => {
    let message: unknown;
    let action: (() => void) | undefined;
    try {
      if (
        typeof data !== "string" ||
        new TextEncoder().encode(data).byteLength > SOCKET_MAX_BYTES
      )
        throw new Error("Expected JSON text under 64 KiB");
      message = JSON.parse(data);
      if (!isSocketEnvelope(message))
        throw new Error("Invalid socket envelope");
      if (message.event.startsWith("$"))
        action = control(message.event, message.data);
      else {
        const schema = schemas.get(message.event);
        if (!schema || !Check(schema, message.data))
          throw new Error("Invalid socket output");
      }
    } catch (cause) {
      stop(
        new BrickSocketError(
          "protocol",
          "Server sent an invalid socket message",
          { cause },
        ),
        4000,
        "Invalid server message",
      );
      return;
    }
    if (action) action();
    else if (isSocketEnvelope(message))
      for (const listener of events.get(message.event) ?? [])
        listener(message.data);
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  if (!finished && options.timeoutMs !== undefined)
    timer = setTimeout(
      () =>
        stop(new BrickSocketError("connection", "Socket connection timed out")),
      options.timeoutMs,
    );
  return api;
}
