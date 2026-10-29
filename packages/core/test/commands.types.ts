import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { defineListener, defineService, emitEvent, t } from "../src";

const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  total: integer("total").notNull(),
});
const lines = sqliteTable("invoice_lines", {
  id: integer("id").primaryKey(),
  invoiceId: text("invoice_id").notNull(),
  qty: integer("qty").notNull(),
});

const billing = defineService("billing", {
  events: {
    itemAdded: t.Object({ id: t.String(), qty: t.Number() }),
    paid: t.Object({ id: t.String() }),
  },
});

// Listeners get the payload type from the catalog.
defineListener({
  name: "typed",
  on: billing.events.itemAdded,
  run: ({ payload }) => {
    const qty: number = payload.qty;
    // @ts-expect-error not in the payload
    void payload.missing;
    void qty;
  },
});
defineListener({
  name: "both",
  on: [billing.events.itemAdded, billing.events.paid],
  run: ({ payload }) => {
    const id: string = payload.id;
    void id;
  },
});
// String names still work, with the payload the caller states.
defineListener<{ id: string }>({
  name: "crud",
  on: "invoice.create",
  run: ({ payload }) => void payload.id,
});

declare const ctx: { db: unknown };
void emitEvent(ctx, billing.events.paid, { id: "i1" });
// @ts-expect-error the payload is checked
void emitEvent(ctx, billing.events.paid, { id: 1 });
// @ts-expect-error not a declared event
void billing.events.refunded;

const invoice = billing.resource({
  name: "invoice",
  table: invoices,
  children: { lines: { table: lines, parent: lines.invoiceId } },
});

const addLine = invoice.command("addLine", {
  input: t.Object({ qty: t.Number() }),
  errors: { NOT_DRAFT: { status: 409, message: "Not a draft" } },
  access: "public",
  load: { children: ["lines"] },
  decide: (row, input, { error }) => {
    const loaded: number = row.lines.length;
    void loaded;
    return row.status !== "draft"
      ? error.NOT_DRAFT()
      : {
          set: { total: row.total + input.qty },
          children: { lines: { insert: [{ qty: input.qty }] } },
          emit: { itemAdded: { id: row.id, qty: input.qty } },
        };
  },
});
addLine.decide(
  { id: "i", status: "draft", total: 0, lines: [] },
  { id: "i", qty: 1 },
);

invoice.command("pay", {
  access: "public",
  // @ts-expect-error only declared events can be emitted
  decide: (row) => ({ emit: { refunded: { id: row.id } } }),
});
invoice.command("payWrong", {
  access: "public",
  // @ts-expect-error the payload is checked against the catalog
  decide: () => ({ emit: { paid: { id: 1 } } }),
});
invoice.command("noLoad", {
  access: "public",
  decide: (row) => {
    // @ts-expect-error children not loaded are not on the row
    void row.lines;
    return {};
  },
});
invoice.command("badChild", {
  access: "public",
  // @ts-expect-error only declared child tables load
  load: { children: ["nope"] },
  decide: () => ({}),
});

// In-process call: id joins the input.
void addLine({ input: { id: "i", qty: 2 } });
