import { describe, expect, test } from "bun:test";
import { runLoad } from "./lib/load";
import { percentile, summarize } from "./lib/stats";
import { checkGates } from "./lib/manifest";
import { startBrickServer } from "./http-server";

describe("benchmark lab", () => {
  test("percentiles and empty samples", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(summarize([]).count).toBe(0);
    expect(summarize([1, 2, 3]).p50_ms).toBe(2);
  });
  test("load accounting counts HTTP failures without negative goodput", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("bad", { status: 403 }) });
    try {
      const r = await runLoad({ url: `http://127.0.0.1:${server.port}`, requests: 10, concurrency: 2 });
      expect(r.completed).toBe(10);
      expect(r.errors).toBe(10);
      expect(r.successful).toBe(0);
      expect(r.goodput_rps).toBe(0);
      expect(r.latencies_ms.length).toBe(10);
    } finally { server.stop(true); }
  });
  test("load parameters reject zero and negative values", async () => {
    await expect(runLoad({ url: "http://localhost", requests: 0, concurrency: 1 })).rejects.toThrow();
    await expect(runLoad({ url: "http://localhost", requests: 1, concurrency: -1 })).rejects.toThrow();
  });
  test("advisory gates still report actual regression", () => {
    const r = checkGates({ rpsBase: 100, rpsCand: 80, p99Base: 1, p99Cand: 1,
      cpuPerReqBase: 1, cpuPerReqCand: 1, rssBase: 1, rssCand: 1, enforce: false });
    expect(r.gates[0]!.pass).toBe(false);
    expect(r.pass).toBe(false);
  });
  test("layered responses are equivalent and auth succeeds", async () => {
    const bench = await startBrickServer({ port: 0, rows: 20 });
    const base = `http://127.0.0.1:${bench.app.server.port}`;
    try {
      for (const path of ["/__bench/noop", "/api/bench/noop", "/api/bench/validated", "/api/bench/full"]) {
        const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-user-id": "bench-user" },
          body: JSON.stringify({ slug: "test", title: "Benchmark", count: 3 }) });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
      }
      const list = await fetch(base + "/api/item?search=Benchmark&limit=20");
      expect(list.status).toBe(200);
      expect((await list.json() as { items: unknown[] }).items.length).toBe(20);
    } finally { await bench.stop(); }
  });
});
