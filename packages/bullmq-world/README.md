# @brickkit/bullmq-world

Production-grade Redis workflow backend powered by BullMQ. Uses Redis for storage and BullMQ for advanced job queue management with priorities, delays, retries, and observability.

## Why Use This Package

- **Production-Ready**: Battle-tested BullMQ queue system
- **Advanced Queue Features**: Job priorities, delays, retries, rate limiting
- **Observability**: Built-in queue monitoring and metrics via BullMQ
- **Reliable Processing**: Automatic retries and dead letter queues
- **Scalable Workers**: Horizontal scaling with multiple worker processes

Best for production deployments that require robust job processing, queue management, and operational visibility.

## Installation

```bash
bun add @brickkit/bullmq-world
# or: npm install @brickkit/bullmq-world
```

## Usage

### Environment Variables

```bash
# Required
export WORKFLOW_REDIS_URL="redis://localhost:6379"

# Optional
export WORKFLOW_REDIS_KEY_PREFIX="workflow:"      # Default: 'workflow:'
export WORKFLOW_REDIS_JOB_PREFIX="workflow_"      # Default: 'workflow_'
export WORKFLOW_REDIS_WORKER_CONCURRENCY="10"    # Default: 10
```

### Programmatic Usage

```typescript
import { createWorld } from "@brickkit/bullmq-world";

const world = createWorld({
  redis: "redis://localhost:6379",
  // or use RedisOptions object:
  // redis: { host: 'localhost', port: 6379, password: 'secret' },

  keyPrefix: "workflow:", // optional, for storage keys
  jobPrefix: "workflow_", // optional, for BullMQ queue names
  queueConcurrency: 10, // optional, worker concurrency
});

await world.start();
```

## Architecture

- **Storage**: Redis Hashes and Sorted Sets, written by Lua scripts so each event and the entity it changes commit together
- **Queue**: BullMQ with Redis-backed job processing, one queue for workflow and step work
- **Streaming**: Redis Streams plus Pub/Sub
- **Event IDs**: a run's events are numbered by position (`evnt_00000000000000000000000001` is the first). The next position is taken inside the script that appends the event, so writers racing for it never leave a gap, and a writer that is behind is told which events it missed instead of being refused

## Compatibility

This world implements the Workflow SDK **v5** World spec (`workflow` 5.x, `@workflow/world` 5.x). It does not work with `workflow` 4.x, which uses the older spec.

It does not implement the optional in-band writer fence, `$retention: '0'` purging, hook token retention, or `createBatch`. Each costs performance or a safeguard, never correctness: the runtime routes around an absent one. On `start()` it re-enqueues runs that were in flight, so a queue that lost its jobs does not strand them.

### Upgrading from v4

If you are coming from a Redis world built for `workflow` 4.x (for example `@brickkit/bullmq-world` 2.x or `@workflow-worlds/redis`), read this before you deploy.

Runs already in Redis cannot be replayed by this world. A v4 run numbers its events with ULIDs, and the v5 runtime refuses an event id that is not a position. There is no mixed mode.

Either let in-flight runs finish on the v4 build before you deploy this one, or point this world at a fresh `keyPrefix` (and `jobPrefix`) so the two never share keys. Stream, hook, and step data written by the v4 world is not read either, so draining is the safe path.

## BullMQ Features

This package provides advanced queue capabilities through BullMQ:

- **Job Priorities**: Process high-priority workflows first
- **Delayed Jobs**: Schedule workflows for future execution
- **Automatic Retries**: Configurable retry logic with exponential backoff
- **Rate Limiting**: Control job processing rate
- **Job Events**: Monitor job lifecycle (completed, failed, progress)
- **Queue Metrics**: Track throughput, latency, and failure rates
- **Worker Management**: Multiple workers with different concurrency settings

## Configuration Options

Every option is passed to `createWorld({ ... })`. The first four also have environment variables, read when `createWorld()` is called with no arguments.

| Option                 | Type                       | Default                                  | Description                                                                                                                                  |
| ---------------------- | -------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `redis`                | `string \| RedisOptions`   | `redis://localhost:6379`                 | Redis connection URL or ioredis options. Env: `WORKFLOW_REDIS_URL`, then `REDIS_URL`                                                         |
| `keyPrefix`            | `string`                   | `workflow:`                              | Prefix for storage keys. Env: `WORKFLOW_REDIS_KEY_PREFIX`                                                                                    |
| `jobPrefix`            | `string`                   | `workflow_`                              | Prefix for BullMQ queue names. Env: `WORKFLOW_REDIS_JOB_PREFIX`                                                                              |
| `queueConcurrency`     | `number`                   | `10`                                     | Jobs one worker process runs at once. Env: `WORKFLOW_REDIS_WORKER_CONCURRENCY`                                                               |
| `baseUrl`              | `string`                   | `WORKFLOW_BASE_URL` or `localhost:$PORT` | Where a worker delivers jobs over HTTP. Not used when an in-process handler is registered                                                    |
| `httpTimeoutMs`        | `number`                   | `300000`                                 | Per-delivery HTTP timeout. Raise it for long steps; a timeout counts as a failed attempt while the original handler keeps running            |
| `maxAttempts`          | `number`                   | `73`                                     | Delivery attempts before a job is retired. Keep it above the runtime's own ceiling of 48, or a run can be stranded                           |
| `backoffType`          | `'fixed' \| 'exponential'` | `exponential`                            | Retry delay curve                                                                                                                            |
| `backoffDelayMs`       | `number`                   | `1000`                                   | Base retry delay                                                                                                                             |
| `maxBackoffMs`         | `number`                   | `30000`                                  | Longest a retry is delayed                                                                                                                   |
| `stalledInterval`      | `number`                   | `30000`                                  | How often workers look for jobs whose lock expired                                                                                           |
| `maxStalledCount`      | `number`                   | `10`                                     | Times a job may be recovered from a stall before it fails                                                                                    |
| `lockDuration`         | `number`                   | BullMQ's `30000`                         | Job lock TTL before another worker takes over (ms). Set to at least 2x the longest event-loop block; max `2147483647`                        |
| `idempotencyTtlMs`     | `number`                   | none                                     | Expire the dedup key of an `idempotencyKey` after this long. By default it lives until the job finishes, which is what the runtime relies on |
| `maxEventsPerRun`      | `number`                   | `WORKFLOW_MAX_EVENTS` or `25000`         | Event ceiling reported to the runtime                                                                                                        |
| `enableAutoPipelining` | `boolean`                  | `true`                                   | Batch commands issued in the same tick into one write                                                                                        |

## Redis Data Structures

**Storage:**

- Runs: `workflow:run:{runId}` (body), `workflow:run:meta:{runId}` (status and spec version), `workflow:run:attrs:{runId}` (attributes, a hash of their own so concurrent changes merge)
- Run indexes: `workflow:runs:index`, `workflow:runs:by_name:{name}`, `workflow:runs:by_status:{status}`
- Events: `workflow:events:data:{runId}` (hash of `eventId` to event), `workflow:events:by_correlation:{runId}:{correlationId}` (sorted set scored by position)
- Steps: `workflow:step:{runId}:{stepId}`, `workflow:step:status:{runId}:{stepId}` (`status|attempt`, checked atomically), `workflow:steps:by_run:{runId}`
- Hooks: `workflow:hook:{hookId}`, `workflow:hooks:by_token:{token}`, `workflow:hooks:by_run:{runId}`
- Streams: `workflow:stream:{runId}:{name}`

**BullMQ Queues:**

- `{jobPrefix}flows` - Workflow invocations and the steps they run
- Plus BullMQ internal structures for job management

## Monitoring

BullMQ provides built-in monitoring capabilities:

```typescript
import { Queue } from "bullmq";

// Access queue metrics
const flowQueue = new Queue("workflow_flows", {
  connection: { host: "localhost", port: 6379 },
});

const counts = await flowQueue.getJobCounts();
console.log(counts); // { waiting, active, completed, failed, delayed }
```

Use tools like:

- **Bull Board**: Web UI for monitoring BullMQ queues
- **BullMQ Metrics**: Prometheus metrics exporter
- **Redis Commander**: View queue data structures

## Local Development

```bash
# Start Redis with Docker
docker run -d -p 6379:6379 redis:7-alpine

# Set environment
export WORKFLOW_REDIS_URL="redis://localhost:6379"

# Run your workflows
```

## When to Choose This Package

**Use @brickkit/bullmq-world when:**

- Production deployments requiring reliability
- You need job priorities, delays, or retries
- Observability and monitoring are important
- Multiple worker processes for horizontal scaling
- Advanced queue features justify the complexity

## Retention

Finished runs are kept forever unless you set a policy. It takes the shape of BullMQ's `removeOnComplete`: `age` in seconds, `count` of newest runs to keep. A status without a policy is kept.

```ts
createWorld({
  redis: "redis://localhost:6379",
  retention: {
    completed: { age: 24 * 60 * 60, count: 1000 },
    failed: { age: 7 * 24 * 60 * 60 },
    // cancelled: not set, so cancelled runs are kept
  },
  // How long BullMQ keeps its own finished jobs (delivery records)
  jobRetention: {
    removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  },
});
```

A run past its policy is deleted with its event log, steps, hooks, and streams. Running runs are never touched. Each worker sweeps every `sweepIntervalMs` (default 60000, set inside `retention`), at most `batchSize` runs per status (default 200); one lock per interval keeps the workers from sweeping together. `world.sweepRetention()` runs a sweep on demand.

## Performance Considerations

- **BullMQ Overhead**: Slightly higher Redis memory usage than pure Lists
- **Worker Scaling**: Add more worker processes to increase throughput
- **Redis Configuration**: Use a single primary with Redis Sentinel or a replica for failover. Redis Cluster is not supported: the Lua scripts touch several keys that do not share a hash slot. Turn on persistence (AOF), since run history lives in Redis
- **Data Retention**: Off by default, so runs, event logs, steps, hooks, and streams stay until you delete them. Set `retention` (below) to have a reaper on each worker delete finished runs past their policy
- **Job Retention**: `jobRetention` sets how long BullMQ keeps its own finished jobs

## License

Apache License
