import { beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { defineService, defineDatabase, sqliteTable, text, integer, syncSchema, resetGlobalRegistry } from "@elregaldo/core";
import { compilePlans, loadPlans } from "../src/plans";
import { createBrickServer } from "../src/server";

const table = sqliteTable('physical_notes', {
  id: text('note_id').primaryKey(),
  title: text('note_title').notNull(),
  ownerId: text('owner_id'),
  pinned: integer('is_pinned', { mode: 'boolean' }).notNull(),
});
const compiler = resolve(import.meta.dir, '../../../native/brickc/target/debug/brickc');

describe('brickc offline plans', () => {
  beforeAll(async () => {
    const child = Bun.spawn(['cargo', 'build', '--manifest-path', resolve(import.meta.dir, '../../../native/brickc/Cargo.toml')], { stdout: 'ignore', stderr: 'inherit' });
    expect(await child.exited).toBe(0);
  }, 120000);
  it('compiles real manifests, reloads artifacts and preserves mapping, policy and CRUD', async () => {
    resetGlobalRegistry();
    const dir = await mkdtemp(resolve(tmpdir(), 'brick-plans-'));
    const database = defineDatabase({ tables: [table] });
    const db = database.getDb();
    syncSchema(database.tables, db);
    const otherDatabase = defineDatabase({ tables: [table] });
    const otherDb = otherDatabase.getDb();
    syncSchema(otherDatabase.tables, otherDb);
    await otherDb.insert(table).values({ id: "n1", title: "Other database", ownerId: "u1", pinned: false });
    const svc = defineService('notes', { database, context: (ctx: any) => ({
      user: { id: ctx.request.headers.get('x-user') ?? 'u1' },
      ...(ctx.request.headers.get('x-db') === 'other' ? { db: otherDb } : {}),
    }) });
    svc.resource({ name: 'note', table, ownerField: 'ownerId' });
    await db.insert(table).values({ id: 'n1', title: 'Hello', ownerId: 'u1', pinned: true });
    try {
      const output = resolve(dir, 'plans.json');
      const plans = await compilePlans([svc], { compiler, output });
      expect(await loadPlans(output)).toEqual(plans);
      expect(plans.resources[0].getSql).toBe('SELECT * FROM "physical_notes" WHERE "note_id" = $1 LIMIT 1');
      const app = createBrickServer({ services: [svc], plans, docs: false, requestLogging: false });
      const read = (path: string, user = 'u1') => app.handle(new Request(`http://localhost${path}`, { headers: { 'x-user': user } }));
      const response = await read('/api/note/n1');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: 'n1', title: 'Hello', ownerId: 'u1', pinned: true });
      expect((await read('/api/note/n1', 'u2')).status).toBe(403);
      expect((await read('/api/note/missing')).status).toBe(404);
      const otherResponse = await app.handle(new Request('http://localhost/api/note/n1', { headers: { 'x-db': 'other' } }));
      expect(otherResponse.status).toBe(200);
      expect((await otherResponse.json()).title).toBe('Other database');
      const alias = await app.handle(new Request('http://localhost/api/notes/note.get', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'n1' }),
      }));
      expect(alias.status).toBe(200);
      const updated = await app.handle(new Request('http://localhost/api/note/n1', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Updated', pinned: false }),
      }));
      expect(updated.status).toBe(200);
      expect((await updated.json()).pinned).toBe(false);
      const list = await read('/api/note?limit=5');
      expect(list.status).toBe(200);
      expect((await list.json()).notes[0].title).toBe('Updated');
      expect(() => createBrickServer({ services: [svc], plans: { ...plans, sourceManifest: '{}' } })).toThrow('stale');
      expect(() => createBrickServer({ services: [svc], plans: { ...plans, resources: [] } })).toThrow('do not match');
      expect(() => createBrickServer({ services: [svc], plans: { ...plans, resources: [...plans.resources, ...plans.resources] } })).toThrow('do not match');
    } finally {
      (db as any).$client.close();
      (otherDb as any).$client.close();
      await rm(dir, { recursive: true });
    }
  });

  it('reports compiler failure without emitting a valid artifact', async () => {
    await expect(compilePlans([], { compiler: '/usr/bin/false' })).rejects.toThrow('brickc failed');
  });
});
