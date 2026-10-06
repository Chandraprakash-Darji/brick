/** Paired current-runtime vs brickc comparison, alternating order after warmup. */
import { eq } from '../packages/core/src/index';
import { benchTable } from './lib/fixtures';
import { startBrickServer } from './http-server';
import { runLoad } from './lib/load';
import { collectManifest, stamp, writeJson } from './lib/manifest';
import { parseArgs, argInt } from './lib/stats';

const args = parseArgs(process.argv.slice(2));
const requests = argInt(args, 'requests', 20000);
const rounds = argInt(args, 'rounds', 5);
const concurrency = argInt(args, 'concurrency', 16);
const baseline = await startBrickServer({ port: 3461, rows: 5000 });
let compiled: Awaited<ReturnType<typeof startBrickServer>> | undefined;
try {
  compiled = await startBrickServer({ port: 3462, rows: 5000, compiled: true });
  const results: any[] = [];
  const run = async (variant: string, port: number, count: number) => {
    const result = await runLoad({ url: `http://127.0.0.1:${port}/api/item/seed_0`, requests: count, concurrency });
    if (result.errors || result.successful !== count) throw new Error(`${variant} returned errors`);
    const { latencies_ms, ...summary } = result;
    return { variant, ...summary };
  };
  const a = await fetch('http://127.0.0.1:3461/api/item/seed_0').then(r => r.json());
  await compiled.db.update(benchTable).set(a).where(eq(benchTable.id, 'seed_0'));
  const b = await fetch('http://127.0.0.1:3462/api/item/seed_0').then(r => r.json());
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Response mismatch');
  await run('baseline', 3461, 3000);
  await run('brickc', 3462, 3000);
  for (let round = 0; round < rounds; round++) {
    for (const [variant, port] of round % 2 ? [['brickc', 3462], ['baseline', 3461]] as const : [['baseline', 3461], ['brickc', 3462]] as const) {
      const result = await run(variant, port, requests);
      results.push({ round, ...result });
      console.log(`${round + 1}: ${variant} ${result.goodput_rps.toLocaleString()} RPS p99=${result.latency.p99_ms}ms`);
    }
  }
  const median = (numbers: number[]) => numbers.sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
  const summary = Object.fromEntries(['baseline', 'brickc'].map(variant => [variant, {
    median_goodput_rps: median(results.filter(r => r.variant === variant).map(r => r.goodput_rps)),
    median_p99_ms: median(results.filter(r => r.variant === variant).map(r => r.latency.p99_ms)),
  }]));
  console.log(JSON.stringify(summary, null, 2));
  console.log(await writeJson(`compiled-${stamp()}.json`, {
    manifest: collectManifest({ benchmark: 'brickc-paired-get', db: 'sqlite-memory', dataset_rows: 5000 }),
    requests, rounds, concurrency, summary, results,
  }));
} finally {
  await baseline.stop();
  await compiled?.stop();
}
