import { beforeAll, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { defineDatabase, defineService, sqliteTable, text, integer, syncSchema, resetGlobalRegistry, t } from "@elregaldo/core";
import { createBrickServer } from "../src/server";
import { createNativeWorker } from "../src/native-worker";
import { compilePlans } from "../src/plans";
import { startNativeHttp } from "../src/native";

const compiler = resolve(import.meta.dir, '../../../native/brickc/target/release/brickc');
const executable = resolve(import.meta.dir, '../../../native/brick-http/target/release/brick-http');
beforeAll(async () => {
  for (const crate of ['brickc', 'brick-http']) {
    const child = Bun.spawn(['cargo', 'build', '--release', '--manifest-path', resolve(import.meta.dir, `../../../native/${crate}/Cargo.toml`)], { stdout: 'ignore', stderr: 'inherit' });
    expect(await child.exited).toBe(0);
  }
}, 120000);

it('serves supported CRUD and built-in endpoints in Rust, preserves TS callbacks, and shuts down both listeners', async () => {
  resetGlobalRegistry();
  const directory = await mkdtemp(resolve(tmpdir(), 'brick-native-test-'));
  const table = sqliteTable('physical_items', {
    id: text('item_id').primaryKey(), title: text('item_title').notNull(), pinned: integer('is_pinned', { mode: 'boolean' }).notNull(),
  });
  const database = defineDatabase({ tables: [table], path: resolve(directory, 'db.sqlite') });
  const db = database.getDb();
  syncSchema(database.tables, db);
  const service = defineService('native', { database });
  service.resource({ name: 'item', pluralName: 'records', table, defaultSort: 'id', excludeFromList: [], operations: { list: { defaultLimit: 2 } } });
  service.action({ name: 'getCustom', authorize: ({ ctx }) => ctx.request.headers.get('authorization') === 'Bearer ok',
    execute: () => ({ executedBy: 'typescript' }) });
  service.action({ name: 'readEcho', path: '/echo/:id', method: 'GET',
    input: t.Object({ id: t.String(), count: t.Number(), active: t.Boolean() }), execute: ({ input }) => input });
  const protectedService = defineService('protected', { database, context: (ctx: any) => ({ user: { id: ctx.request.headers.get('x-user') } }) });
  protectedService.resource({ name: 'guarded', table, ownerField: 'title' });
  await db.insert(table).values([{ id: 'a', title: 'u1', pinned: true }, { id: 'b', title: 'Second', pinned: false }, { id: 'c', title: 'Last', pinned: true }]);
  const changed = service.resource({ name: 'changed', table, defaultSort: 'id' });
  changed.actions.get.config.execute = async () => ({ id: 'custom', title: 'custom', pinned: true });
  const services = [service, protectedService];
  const plans = await compilePlans(services, { compiler, native: true });
  expect(plans.nativeReads?.map(p => p.resource)).toEqual(['item']);
  const baseline = createBrickServer({ services, docs: false, requestLogging: false });
  const app = createNativeWorker({ services, plans });
  const stopWorker = app.stop.bind(app);
  // Reserve an available port, then release it for the native listener.
  const reserve = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = reserve.port;
  reserve.stop(true);
  const url = `http://127.0.0.1:${port}`;
  try {
    await startNativeHttp(app, services, plans, { port, executable });
    for (const path of ['/api/item?limit=2', '/api/item?limit=2&offset=2', '/api/item?limit=2&page=2', '/api/item/a', '/api/item/missing', '/api/item?limit=0', '/api/item?title=u1']) {
      const expected = await baseline.handle(new Request(`http://localhost${path}`));
      const actual = await fetch(`${url}${path}`);
      expect(actual.headers.get('x-brick-runtime')).toBe('rust');
      expect(actual.status).toBe(expected.status);
      expect(await actual.json()).toEqual(await expected.json());
    }
    const echo = await fetch(`${url}/echo/hello%20world?count=3&active=true`);
    expect(echo.status).toBe(200);
    expect(await echo.json()).toEqual({ id: 'hello world', count: 3, active: true });
    expect((await fetch(`${url}/echo/hello?count=invalid&active=true`)).status).toBe(400);
    const invalidBody = await fetch(`${url}/api/item`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    expect(invalidBody.status).toBe(400);
    expect((await fetch(`${url}/api/native/getCustom`)).status).toBe(403);
    const custom = await fetch(`${url}/api/native/getCustom`, { headers: { authorization: 'Bearer ok', 'x-trace-id': 'custom-trace' } });
    expect(custom.status).toBe(200);
    expect(custom.headers.get('x-trace-id')).toBe('custom-trace');
    expect(await custom.json()).toEqual({ executedBy: 'typescript' });
    expect((await fetch(`${url}/api/changed/a`).then(r => r.json())).id).toBe('custom');
    expect((await fetch(`${url}/api/guarded/a`, { headers: { 'x-user': 'other' } })).status).toBe(403);
    const update = await fetch(`${url}/api/item/a`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Updated', pinned: false }) });
    expect(update.status).toBe(200);
    expect((await update.json()).title).toBe('Updated');
    // Closing the Bun worker proves a successful native read is served entirely by Rust.
    const expectedArchitecture = await baseline.handle(new Request("http://localhost/_brick/services")).then(r => r.json());
    await stopWorker();
    const healthResponse = await fetch(`${url}/_health`);
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.headers.get('x-brick-runtime')).toBe('rust');
    const health = await healthResponse.json();
    expect(health.status).toBe('ok');
    expect(health.uptime).toBeGreaterThanOrEqual(0);
    expect(Math.abs(health.timestamp - Date.now())).toBeLessThan(5000);
    const architecture = await fetch(`${url}/_brick/services`);
    expect(architecture.status).toBe(200);
    expect(await architecture.json()).toEqual(expectedArchitecture);
    const nativeOnly = await fetch(`${url}/api/item/a`);
    expect(nativeOnly.status).toBe(200);
    expect(await nativeOnly.json()).toEqual({ id: 'a', title: 'Updated', pinned: false });
    expect((await fetch(`${url}/api/item?limit=2`)).status).toBe(200);
    expect((await fetch(`${url}/api/item/missing`)).status).toBe(404);
    // Generated writes and documentation also work with no TS worker.
    const createdResponse = await fetch(`${url}/api/item`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Native create', pinned: true }) });
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json();
    expect(created.id.startsWith('ite_')).toBe(true);
    expect(created.title).toBe('Native create');
    const patched = await fetch(`${url}/api/item/${created.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pinned: false }) });
    expect(patched.status).toBe(200);
    expect((await patched.json()).pinned).toBe(false);
    const removed = await fetch(`${url}/api/item/${created.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ success: true, id: created.id });
    expect((await fetch(`${url}/api/item/${created.id}`)).status).toBe(404);
    const specResponse = await fetch(`${url}/openapi.json`);
    expect(specResponse.status).toBe(200);
    expect((await specResponse.json()).paths['/api/native/item.get']).toBeDefined();
    for (const path of ['/docs', '/swagger']) {
      const document = await fetch(`${url}${path}`);
      expect(document.status).toBe(200);
      expect(document.headers.get('content-type')).toContain('text/html');
    }
    expect((await fetch(`${url}/api/native/getCustom`, { headers: { authorization: 'Bearer ok' } })).status).toBe(502);
  } finally {
    await app.stop();
    (db as any).$client.close();
    await rm(directory, { recursive: true });
  }
}, 30000);
