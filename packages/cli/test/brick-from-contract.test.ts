import { describe, it, expect } from "bun:test";
import {
  defineAction,
  defineDatabase,
  defineService,
  syncSchema,
  sqliteTable,
  text,
  integer,
  t,
} from "@brickkit/core";
import { createBrickClient, defineAppContract } from "@brickkit/core/client";
import { brickFromContract } from "../src/contract";

const notesTable = sqliteTable("contract_notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
  userId: text("user_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

function buildContract() {
  const database = defineDatabase({ tables: [notesTable] });
  syncSchema(database.tables, database.getDb());

  const billing = defineService("contract_billing");
  const charge = billing.action({
    name: "charge",
    input: t.Object({ amount: t.Number() }),
    output: t.Object({ ok: t.Boolean() }),
    execute: async () => ({ ok: true }),
  });

  const notes = defineService("contract_notes", { database });
  const note = notes.resource({
    name: "contract_note",
    table: notesTable,
    ownerField: "userId",
    operations: {
      list: true,
      get: true,
      create: true,
      update: true,
      delete: true,
    },
  });

  // Single source of truth: actions and a resource side by side.
  return defineAppContract({ billing: { charge }, note });
}

describe("brickFromContract (contract-first server)", () => {
  it("serves the app from the contract with no separate services list", async () => {
    const contract = buildContract();
    const app = brickFromContract(contract);
    const api = createBrickClient<typeof contract>({
      baseUrl: "http://localhost:4000",
      // Contract keys (`billing`, `note`) intentionally differ from backend
      // names (`contract_billing`, `contract_note`): routing uses bound metadata.
      contract,
      fetch: ((url: any, init: any) =>
        app.handle(new Request(url, init))) as typeof fetch,
    });

    expect(await api.billing.charge({ amount: 10 })).toEqual({ ok: true });

    const created = await (api as any).note.create({
      title: "Hello",
      content: "World",
    });
    expect(created.id).toBeDefined();
    const listed = await (api as any).note.list({ limit: 5 });
    expect(listed.total).toBe(1);
  });

  it("passes options such as prefix through to brick()", async () => {
    const contract = buildContract();
    const app = brickFromContract(contract, { prefix: "/v1" });

    const res = await app.handle(
      new Request("http://localhost:4000/v1/contract_billing/charge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 1 }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects contracts with actions not bound to a service", () => {
    const orphan = defineAction({
      name: "orphan",
      output: t.Object({ ok: t.Boolean() }),
      execute: async () => ({ ok: true }),
    });
    expect(() => brickFromContract({ orphan } as any)).toThrow(
      /not bound to a service.*'orphan'/,
    );
  });

  it("rejects contracts whose service was never registered", () => {
    const ghost = defineAction({
      name: "ghost.op",
      output: t.Object({ ok: t.Boolean() }),
      execute: async () => ({ ok: true }),
    });
    // Bound to a name with no registered service (plain expando, no registry write).
    (ghost as any).serviceName = "ghost-svc";
    expect(() => brickFromContract({ ghost: { op: ghost } })).toThrow(
      /service 'ghost-svc'.*is not registered/,
    );
  });

  it("rejects empty contracts", () => {
    expect(() => brickFromContract({})).toThrow(/no actions/);
  });
});
