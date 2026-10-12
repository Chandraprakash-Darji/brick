import { test, expect } from "bun:test";
import type { Database } from "bun:sqlite";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import {
  defineService,
  defineDatabase,
  getGlobalRegistry,
  resetGlobalRegistry,
  generateOpenApiSpec,
  t,
} from "@brickkit/core";
import { crud } from "../src";

const records = sqliteTable("introspect_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name"),
  userId: text("user_id"),
});

let sequence = 0;

function setup(options: Parameters<typeof crud>[0]) {
  resetGlobalRegistry();
  const database = defineDatabase({ tables: [records] });
  const db = database.getDb();
  const sqlite = (db as typeof db & { $client: Database }).$client;
  sqlite.exec(
    "CREATE TABLE introspect_records (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,user_id TEXT)",
  );
  const service = defineService(`introspect_${sequence++}`, { database });
  const resource: any = service
    .resource({ name: "record", table: records, id: records.id })
    .use(crud(options));
  return { service, resource, sqlite };
}

const CRUD_OPS = [
  "list",
  "get",
  "create",
  "update",
  "delete",
  "findOne",
  "count",
  "exists",
];

function crudActions(service: { introspect(): any }) {
  const arch = service.introspect();
  const actions = arch.actions.filter((a: any) =>
    CRUD_OPS.some((op) => a.name === op || a.name.endsWith(`.${op}`)),
  );
  return { arch, actions };
}

test("CRUD with authorize+scope reports hasAuthorize/hasScope/scoped", () => {
  const { service, sqlite } = setup({
    access: {
      authorize: ({ ctx }: any) => !!ctx.user?.id,
      scope: ({ operation, ctx }: any) =>
        operation === "create"
          ? undefined
          : eq(records.userId, (ctx as any).user.id),
    },
    fields: {
      id: { read: true, filter: ["eq"] },
      name: { read: true, create: true, update: true },
      userId: { read: true },
    },
  });
  try {
    const { actions } = crudActions(service);
    expect(actions).toHaveLength(8);
    for (const action of actions) {
      expect(action.hasAuthorize).toBe(true);
      expect(action.hasScope).toBe(true);
      expect(action.accessPolicy).toBe("scoped");
    }
    // exportArchitecture() surfaces the same policy (issue #28 repro).
    const exported = getGlobalRegistry().exportArchitecture();
    const svc = exported.services.find((s) => s.name === service.name)!;
    expect(svc).toBeDefined();
    for (const action of svc.actions.filter((a) =>
      CRUD_OPS.some((op) => a.name.endsWith(`.${op}`)),
    )) {
      expect(action.hasAuthorize).toBe(true);
      expect(action.accessPolicy).toBe("scoped");
    }
  } finally {
    sqlite.close();
  }
});

test("CRUD with authorize only reports authorized without scope", () => {
  const { service, sqlite } = setup({
    access: { authorize: () => true },
    fields: {
      id: { read: true },
      name: { read: true, create: true },
    },
  });
  try {
    const { actions } = crudActions(service);
    expect(actions).toHaveLength(8);
    for (const action of actions) {
      expect(action.hasAuthorize).toBe(true);
      expect(action.hasScope).toBe(false);
      expect(action.accessPolicy).toBe("authorized");
    }
  } finally {
    sqlite.close();
  }
});

test("CRUD with explicit public reports public (post-#20 opt-in)", () => {
  const { service, sqlite } = setup({
    access: "public",
    fields: {
      id: { read: true },
      name: { read: true, create: true },
    },
  });
  try {
    const { actions } = crudActions(service);
    expect(actions).toHaveLength(8);
    for (const action of actions) {
      expect(action.hasAuthorize).toBe(false);
      expect(action.hasScope).toBe(false);
      expect(action.accessPolicy).toBe("public");
    }
  } finally {
    sqlite.close();
  }
});

test("CRUD without access denies by default and reports as protected (#20)", async () => {
  const { service, resource, sqlite } = setup({
    // Bypass the required-access type to exercise the JS deny-by-default path.
    fields: {
      id: { read: true },
      name: { read: true, create: true },
    },
  } as any);
  try {
    const { actions } = crudActions(service);
    expect(actions).toHaveLength(8);
    for (const action of actions) {
      expect(action.hasAuthorize).toBe(true);
      expect(action.hasScope).toBe(false);
      expect(action.accessPolicy).toBe("authorized");
    }
    await expect(resource.list.run({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  } finally {
    sqlite.close();
  }
});

test("hand-written actions keep config.authorize reporting alongside CRUD", () => {
  resetGlobalRegistry();
  const database = defineDatabase({ tables: [records] });
  const service = defineService(`mixed_${sequence++}`, { database });
  service.action({
    name: "echo",
    input: t.Object({ message: t.String() }),
    output: t.String(),
    authorize: () => true,
    execute: async ({ input }: any) => `Echo: ${input.message}`,
  });
  service.action({
    name: "open",
    output: t.String(),
    execute: async () => "open",
  });
  const arch = service.introspect();
  const echo = arch.actions.find((a) => a.name === "echo")!;
  expect(echo.hasAuthorize).toBe(true);
  expect(echo.hasScope).toBe(false);
  expect(echo.accessPolicy).toBe("authorized");
  const open = arch.actions.find((a) => a.name === "open")!;
  expect(open.hasAuthorize).toBe(false);
  expect(open.accessPolicy).toBe("public");
});

test("OpenAPI advertises security for protected CRUD and omits it for public", () => {
  const scoped = setup({
    access: {
      authorize: () => true,
      scope: () => eq(records.id, 1),
    },
    fields: {
      id: { read: true },
      name: { read: true },
    },
  });
  try {
    const spec = generateOpenApiSpec({ services: [scoped.service as any] });
    const ops = Object.values(spec.paths).flatMap((methods: any) =>
      Object.values(methods),
    ) as any[];
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      expect(op.security).toEqual([{ bearerAuth: [] }]);
    }
    expect((spec.components?.securitySchemes as any)?.bearerAuth).toBeDefined();
  } finally {
    scoped.sqlite.close();
  }

  const pub = setup({
    access: "public",
    fields: {
      id: { read: true },
      name: { read: true },
    },
  });
  try {
    const spec = generateOpenApiSpec({ services: [pub.service as any] });
    const ops = Object.values(spec.paths).flatMap((methods: any) =>
      Object.values(methods),
    ) as any[];
    for (const op of ops) {
      expect(op.security).toBeUndefined();
    }
  } finally {
    pub.sqlite.close();
  }
});
