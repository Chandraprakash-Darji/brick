import {
  defineService,
  defineAction,
  t,
  type Static,
} from "@brick-ts/core";

// --- TypeBox Schemas ---

export const DealSchema = t.Object({
  id: t.String(),
  title: t.String(),
  amount: t.Number(),
  status: t.String(),
  createdAt: t.String(),
});
export type Deal = Static<typeof DealSchema>;

export const CreateDealInputSchema = t.Object({
  title: t.String({ minLength: 1 }),
  amount: t.Number({ minimum: 0 }),
  clientEmail: t.String({ minLength: 3 }),
});
export type CreateDealInput = Static<typeof CreateDealInputSchema>;

export const GetDealInputSchema = t.Object({
  id: t.String({ minLength: 1 }),
});
export type GetDealInput = Static<typeof GetDealInputSchema>;

export const ListDealsInputSchema = t.Object({
  limit: t.Optional(t.Number({ minimum: 1 })),
});
export type ListDealsInput = Static<typeof ListDealsInputSchema>;

export const ListDealsOutputSchema = t.Object({
  deals: t.Array(DealSchema),
  total: t.Number(),
});
export type ListDealsOutput = Static<typeof ListDealsOutputSchema>;

// Internal deal record with storage metadata
export interface DealRecord extends Deal {
  clientEmail: string;
}

// In-memory data store for deals (simulating database persistence)
export const dealsStore = new Map<string, DealRecord>();

export function resetDealsStore(): void {
  dealsStore.clear();
}

// --- Action Definitions ---

export const createDeal = defineAction({
  name: "createDeal",
  description: "Create a new deal with title, amount, and client email",
  input: CreateDealInputSchema,
  output: DealSchema,
  execute: async ({ input, ctx }) => {
    const id = `deal_${Math.random().toString(36).substring(2, 9)}`;
    const newDeal: DealRecord = {
      id,
      title: input.title,
      amount: input.amount,
      clientEmail: input.clientEmail,
      status: "open",
      createdAt: new Date().toISOString(),
    };

    dealsStore.set(id, newDeal);

    ctx.logger?.info?.(`Created deal ${id} ("${newDeal.title}") for $${newDeal.amount}`);

    return {
      id: newDeal.id,
      title: newDeal.title,
      amount: newDeal.amount,
      status: newDeal.status,
      createdAt: newDeal.createdAt,
    };
  },
});

export const getDeal = defineAction({
  name: "getDeal",
  description: "Retrieve deal details by unique ID",
  input: GetDealInputSchema,
  output: DealSchema,
  errors: {
    NOT_FOUND: { status: 404, message: "Deal not found" },
  },
  execute: async ({ input, error, ctx }) => {
    const deal = dealsStore.get(input.id);
    if (!deal) {
      return error.NOT_FOUND(`Deal with ID '${input.id}' not found`);
    }

    ctx.logger?.info?.(`Fetched deal ${deal.id}`);

    return {
      id: deal.id,
      title: deal.title,
      amount: deal.amount,
      status: deal.status,
      createdAt: deal.createdAt,
    };
  },
});

export const listDeals = defineAction({
  name: "listDeals",
  description: "List all deals with optional pagination limit",
  input: ListDealsInputSchema,
  output: ListDealsOutputSchema,
  execute: async ({ input, ctx }) => {
    const all = Array.from(dealsStore.values()).map((d) => ({
      id: d.id,
      title: d.title,
      amount: d.amount,
      status: d.status,
      createdAt: d.createdAt,
    }));

    const limit = input?.limit ?? all.length;
    const items = all.slice(0, limit);

    ctx.logger?.info?.(`Listed ${items.length} of ${all.length} deals`);

    return {
      deals: items,
      total: all.length,
    };
  },
});

// --- Service Definition ---

export const dealsService = defineService("deals", {
  database: true,
})
  .action(createDeal)
  .action(getDeal)
  .action(listDeals);
