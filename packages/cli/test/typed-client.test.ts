import { describe, it, expect, beforeEach } from "bun:test";
import {
  defineService,
  defineDatabase,
  syncSchema,
  sqliteTable,
  text,
  integer,
  t,
  ActionExecutionError,
  ValidationError,
} from "@brickkit/core";
import {
  createBrickClient,
  defineAppContract,
  type BrickClient,
} from "@brickkit/core/client";
import { brick } from "../src/server";

const notesTable = sqliteTable("typed_client_notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
  userId: text("user_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

describe("Typed client end-to-end (@brickkit/cli)", () => {
  let app: ReturnType<typeof brick>;
  let api: BrickClient<AppServer>;

  const billingService = defineService("billing");
  const chargeAction = billingService.action({
    name: "charge",
    input: t.Object({ amount: t.Number() }),
    output: t.Object({ ok: t.Boolean() }),
    errors: {
      INSUFFICIENT_FUNDS: { status: 402, message: "Insufficient funds" },
    },
    execute: async ({ input, error }) => {
      if (input.amount > 100) error.INSUFFICIENT_FUNDS();
      return { ok: true };
    },
  });

  const contract = defineAppContract({
    billing: { charge: chargeAction },
    // Resource actions are `Action<any, …>` at the type level; they still
    // exercise the REST URL conventions at runtime.
    note: {
      list: null as never,
      get: null as never,
      create: null as never,
      update: null as never,
      delete: null as never,
    },
  });
  type AppServer = typeof contract;

  beforeEach(() => {
    const database = defineDatabase({ tables: [notesTable] });
    syncSchema(database.tables, database.getDb());
    const notesService = defineService("typed_client_notes", { database });
    notesService.resource({
      name: "note",
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

    app = brick({ services: [notesService, billingService] });
    api = createBrickClient<AppServer>({
      baseUrl: "http://localhost:4000",
      fetch: ((url: any, init: any) =>
        app.handle(new Request(url, init))) as typeof fetch,
    });
  });

  it("drives resource CRUD through REST routes with typed calls", async () => {
    const created = await (api.note.create as any)({
      title: "Typed note",
      content: "Hello from the client",
    });
    expect(created.id).toBeDefined();

    const listed = await (api.note.list as any)({ limit: 5 });
    expect(listed.total).toBe(1);

    const fetched = await (api.note.get as any)({ id: created.id });
    expect(fetched.content).toBe("Hello from the client");

    const updated = await (api.note.update as any)({
      id: created.id,
      content: "Edited",
    });
    expect(updated.content).toBe("Edited");

    const deleted = await (api.note.delete as any)({ id: created.id });
    expect(deleted.success).toBe(true);

    try {
      await (api.note.get as any)({ id: created.id });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ActionExecutionError);
      expect((err as ActionExecutionError).code).toBe("NOT_FOUND");
    }
  });

  it("calls custom actions over the service/action mesh with domain errors", async () => {
    const ok = await api.billing.charge({ amount: 50 });
    expect(ok).toEqual({ ok: true });

    try {
      await api.billing.charge({ amount: 500 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ActionExecutionError);
      expect((err as ActionExecutionError).code).toBe("INSUFFICIENT_FUNDS");
      expect((err as ActionExecutionError).status).toBe(402);
    }
  });

  it("calls configured action paths with encoded parameters and each HTTP method", async () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
      const service = defineService(`custom_${method.toLowerCase()}`);
      const lookup = service.action({
        name: "lookup",
        path: "/v2/records/:doctype/value",
        method,
        input: t.Object({ doctype: t.String(), field: t.String() }),
        output: t.String(),
        execute: ({ input }) => `${input.doctype}:${input.field}`,
      });
      const contract = { records: { lookup } };
      const server = brick({ prefix: "/v2", services: [service] });
      const client = createBrickClient<typeof contract>({
        baseUrl: "http://localhost:4000",
        prefix: "/v2",
        contract,
        fetch: (url, init) => server.handle(new Request(url, init)),
      });
      expect(
        await client.records.lookup({ doctype: "CRM Deal", field: "name" }),
      ).toBe("CRM Deal:name");
    }
  });

  it("surfaces server-side input validation as ValidationError", async () => {
    try {
      // content is required by the generated create schema.
      await (api.note.create as any)({ title: "Missing content" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
    }
  });
});
