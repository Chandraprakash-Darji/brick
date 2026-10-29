import type { RedisClient } from "bun";
import type { SocketBroker, SocketBrokerMessage } from "./socket-types";

export interface RedisBrokerOptions {
  /** Defaults to `REDIS_URL`, then `redis://localhost:6379`. */
  url?: string;
  /** Emits held while Redis is unreachable; older ones are dropped. Default 1000. */
  queue?: number;
}

/** One Redis connection that reconnects by itself and reports each fresh connection. */
function connection(
  url: string | undefined,
  connected: (redis: RedisClient) => void,
) {
  let redis: RedisClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const waiters: (() => void)[] = [];
  const lost = (client: RedisClient) => {
    if (redis !== client) return;
    redis = undefined;
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      start();
    }, 1000);
  };
  const start = () => {
    if (closed || redis) return;
    // Bun's own reconnect keeps no subscriptions we can see; a fresh client resubscribes explicitly.
    const client = new Bun.RedisClient(url, {
      autoReconnect: false,
      enableOfflineQueue: false,
    });
    redis = client;
    client.onclose = () => lost(client);
    client.connect().then(
      () => {
        if (redis !== client) return;
        connected(client);
        for (const wake of waiters.splice(0)) wake();
      },
      () => lost(client),
    );
  };
  return {
    /** The connected client, starting a connection when there is none. */
    get(): RedisClient | undefined {
      start();
      return redis?.connected ? redis : undefined;
    },
    /** Resolves after the next connection is made and announced, or after `ms`. */
    opened(ms: number): Promise<void> {
      if (redis?.connected) return Promise.resolve();
      start();
      return new Promise((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, ms);
      });
    },
    close() {
      closed = true;
      clearTimeout(timer);
      for (const wake of waiters.splice(0)) wake();
      const client = redis;
      redis = undefined;
      client?.close();
    },
  };
}

/**
 * Fans socket emits and kicks out across processes through Redis pub/sub, one
 * channel per room topic. An emit is a PUBLISH only: every process, the emitting
 * one included, delivers it once to its own connections. Uses Bun's built-in
 * Redis client and two connections, one to publish and one to subscribe.
 */
export function redisBroker(options: RedisBrokerOptions = {}): SocketBroker {
  const limit = options.queue ?? 1000;
  if (!Number.isInteger(limit) || limit < 0)
    throw new Error("redisBroker queue must be a nonnegative integer");
  const channel = (topic: string) => `brick:socket:${topic}`;
  const listeners = new Map<
    string,
    Set<(message: SocketBrokerMessage) => void>
  >();
  const pending = new Map<string, Promise<unknown>>();
  const queue: [string, string][] = [];
  const receive = (payload: string, name: string) => {
    let message: SocketBrokerMessage;
    try {
      message = JSON.parse(payload);
    } catch {
      return;
    }
    for (const deliver of listeners.get(name) ?? []) deliver(message);
  };
  const subscribe = (redis: RedisClient, name: string) => {
    const done = redis.subscribe(name, receive).catch(() => {});
    pending.set(name, done);
    void done.then(() => {
      if (pending.get(name) === done) pending.delete(name);
    });
  };
  const publisher = connection(options.url, (redis) => {
    for (const [name, payload] of queue.splice(0))
      void redis.publish(name, payload).catch(() => {});
  });
  const subscriber = connection(options.url, (redis) => {
    for (const name of listeners.keys()) subscribe(redis, name);
  });
  return {
    publish(message) {
      const name = channel(message.topic);
      const payload = JSON.stringify(message);
      const redis = publisher.get();
      if (redis) {
        void redis.publish(name, payload).catch(() => {});
        return;
      }
      queue.push([name, payload]);
      if (queue.length > limit) queue.shift();
    },
    subscribe(topic, deliver) {
      const name = channel(topic);
      let local = listeners.get(name);
      if (!local) {
        local = new Set();
        listeners.set(name, local);
        const redis = subscriber.get();
        if (redis) subscribe(redis, name);
      }
      local.add(deliver);
      return () => {
        local.delete(deliver);
        if (local.size || listeners.get(name) !== local) return;
        listeners.delete(name);
        pending.delete(name);
        void subscriber
          .get()
          ?.unsubscribe(name)
          .catch(() => {});
      };
    },
    async ready(topic) {
      const name = channel(topic);
      // Wait briefly for Redis, so a join is acknowledged once its emits can arrive.
      if (!pending.has(name)) await subscriber.opened(1000);
      await pending.get(name);
    },
    close() {
      publisher.close();
      subscriber.close();
    },
  };
}
