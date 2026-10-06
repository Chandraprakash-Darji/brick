# Brick benchmark lab

Executable baseline for `docs/rustc/06-benchmarking.md`. Brick does **not**
manage schemas: the benchmark application explicitly creates its own tables,
indexes and SQLite FTS sidecar. No framework behavior is changed.

## Run

```sh
bun install --frozen-lockfile
bun run bench:typecheck
bun run bench:test
bun run bench:smoke              # all suites, small datasets
bun run bench                    # local full matrix; several minutes
bun run bench --large --c1k       # opt-in 10M rows, 10/100 MiB streams, c=1024
```

Results are written to ignored `bench/results/`: per-suite JSON, raw HTTP
latency samples, manifests, query plans, aggregate JSON and Markdown reports.
Keep artifacts outside git when comparing commits.

| Suite | Coverage |
| --- | --- |
| `micro.ts` | Context, action invocation, validation/errors, HTTP query/body assembly, 0/5/20-field coercion, direct/lookup/proxy dispatch, cursor codec, resource list execution, JSON serialization, OpenAPI and server construction |
| `prepared.ts` | Get/list/insert/update/delete: dynamic Drizzle, prepared Drizzle and raw SQL; SQLite query plans |
| `batch.ts` | 1M validations/transforms; bounded-memory JSONL generation/parsing; row/chunk/transaction bulk writes; CPU and synthetic I/O transforms; sequential read/write-heavy profiles; Worker message/compute verification |
| `startup.ts` | Repeated in-process build/listen/first-request timing, 10/100/1000 actions |
| `http.ts` | Equivalent `{ok:true}` framework layers; SQLite CRUD; list, cursor, search/filter, count/page SQL timings; payloads, streams, synthetic RTT and slow-action traffic; file-backed WAL; scaling to 100K (10M opt-in) |
| `postgres.ts` | Optional PostgreSQL HTTP CRUD, database version and `EXPLAIN (ANALYZE, BUFFERS, WAL)` |
| `run-all.ts` | Runs suites, aggregates artifacts, reports framework tax and advisory baseline thresholds |

### Select scenarios

```sh
bun run bench --suites micro,prepared,batch
bun run bench:http --smoke --filter 'floor|tax\.'
bun run bench:http --requests 500 --concurrency 1,16 --filter 'resource\.'
bun run bench --baseline bench/results/run-all-PREVIOUS.json
```

Flags: `--smoke`, `--filter REGEX`, `--requests N`, `--concurrency 1,16,64,256`,
`--rows N`, `--runs N` (startup), `--iters MULTIPLIER` (micro), `--no-file`,
`--large`, `--c1k`, `--pg URL`. Filtering resource/profile paths is not an
isolated parser benchmark: those paths include database execution.

### PostgreSQL

Use a **disposable benchmark database**. No PostgreSQL connection is attempted
unless `--pg` is supplied; missing infrastructure is recorded as skipped.

```sh
bun run bench:postgres --smoke --pg "$BENCH_DATABASE_URL"
bun run bench --pg "$BENCH_DATABASE_URL"
```

The suite creates a random `brick_bench_*` table, seeds it, measures it, and
drops only that table in cleanup. It never applies migrations to application
tables. Real RTT experiments require a separately configured network proxy;
the SQLite suite's `rtt.synthetic-*` timings are **not** PostgreSQL RTT results.

## Measurement limits

- Built-in HTTP traffic is **closed-loop**, fixed-request, same-process
  server + generator. CPU/RSS/event-loop metrics are combined process metrics,
  not server-only measurements. Byte counts cover bodies, not wire headers.
- HTTP success means 2xx; 4xx/5xx, timeouts and transport failures reduce
  goodput. Raw latency samples include failures. Streaming is consumed in
  bounded chunks rather than buffered as a complete response.
- Short smoke runs validate the harness, not p99.9 accuracy. High-concurrency
  runs can saturate the local generator; inspect failures and event-loop delay
  before making throughput or framework-tax claims.
- Micro timings include harness/await overhead. Heap deltas are **net live
  heap changes**, not allocation counts or allocated bytes/op. Codec/coercion
  copies are labelled in code; they do not instrument private functions.
- Startup distribution is in-process and warm after its first iteration.
  Use `hyperfine --warmup 5 --runs 30 'bun bench/startup-once.ts'` for fresh
  process wall times (which include imports and process startup/cleanup).
- Advisory gates are report-only. `--enforce-gates` is deliberately rejected
  until server/generator isolation and dedicated-hardware calibration exist.
- Not yet automated: CSV pipeline, parallel Worker throughput, offered-rate
  mixed-profile saturation sweeps, PostgreSQL RTT injection, same-query
  indexed-vs-fallback search, server GC/allocation profiles, Linux counters,
  DB pool/locks/rows scanned, artifact sizes, differential correctness and
  flame graphs. Do not interpret omitted metrics as zero.

For isolated HTTP profiling, start the server in its own process and use
an external load generator:

```sh
bun bench/http-server.ts --port 3456 --rows 20000
# In another terminal/machine (oha/wrk2 must be installed):
oha -z 60s -c 256 -q 10000 -j http://127.0.0.1:3456/_health
# wrk2, not regular wrk, supports -R:
wrk -t8 -c256 -d120s -R10000 --latency http://127.0.0.1:3456/_health
```

Run dedicated Linux x86_64 measurements with pinned Bun/kernel/CPU, an isolated
generator, repeated runs and alternated A/B order. macOS local results are
exploratory, not release performance claims.

## TypeScript compiler comparison

Compare the specialized handlers against the general action handler with an
external loader and separate server processes:

```sh
bun run bench:compiler --oha /path/to/oha --requests 50000 --rounds 5
# Focus on database operations:
bun run bench:compiler --oha /path/to/oha --cases crud --requests 50000 --rounds 5
```

Both targets run Elysia with identical action definitions, responses, tracing,
validation and auth rules; access logging is off. Cases cover synchronous and
async fixed JSON, validated JSON, context/auth, SQLite resource GET/list/create/
PATCH/PUT/DELETE, health, architecture, OpenAPI, docs, Swagger and Scalar reference.

SQLite uses an in-memory database, two-column rows, 100 seeded rows and a 20-row
list page. Resource context supplies a silent logger in both targets. Fixtures
reset outside timed loads; creates and deletes verify row counts and updates
verify persisted values. DELETE seeds one row per request and uses the parent
Bun loader with unique URLs because oha samples body/URL files randomly. Compare
DELETE only against its paired baseline, not other rows; its CPU/RSS fields
measure the loader, not the separate server. All other cases use external oha.
Responses match before load (health uptime/timestamps vary). Every load checks
all status codes and transport errors. Results include median RPS and p99 over
rotated/reversed trials and are written under `bench/results/`.

These measurements do not establish PostgreSQL throughput, durability costs,
complex schemas or production capacity.

Latest expanded run: [all-route report, 7 October 2026](results/REPORT-compiler-all-routes-20261007.md),
with 8 million measured requests over five rounds. Metadata gains are large;
CRUD gains are modest/mixed, including a DELETE regression.

The prepared-write extension has a newer [paired CRUD report](results/REPORT-compiler-prepared-writes-20261007.md)
with 3 million measured requests. It includes safe INSERT/UPDATE RETURNING and
schema-version probes; PostgreSQL writes retain the original path.
