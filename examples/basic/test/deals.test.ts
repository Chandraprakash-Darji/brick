import { describe, it, expect, beforeEach } from "bun:test";
import {
  ValidationError,
  ActionExecutionError,
  getGlobalRegistry,
} from "@brick-ts/core";
import {
  dealsService,
  createDeal,
  getDeal,
  listDeals,
  resetDealsStore,
} from "../src/services/deals/service";

describe("Deals Service E2E Tests (Slice 0)", () => {
  beforeEach(() => {
    resetDealsStore();
    // Ensure service is registered in global registry
    if (!getGlobalRegistry().has("deals")) {
      getGlobalRegistry().register(dealsService);
    }
  });

  describe("createDeal", () => {
    it("should succeed when executing createDeal with valid data", async () => {
      const dealInput = {
        title: "Enterprise Annual Contract",
        amount: 50000,
        clientEmail: "procurement@globalcorp.com",
      };

      const result = await createDeal({ input: dealInput });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.id).toStartWith("deal_");
      expect(result.title).toBe(dealInput.title);
      expect(result.amount).toBe(dealInput.amount);
      expect(result.status).toBe("open");
      expect(result.createdAt).toBeDefined();
      expect(new Date(result.createdAt).getTime()).not.toBeNaN();
    });

    it("should throw ValidationError when executing createDeal with invalid input", async () => {
      // 1. Missing required fields (amount, clientEmail)
      try {
        await createDeal({ input: { title: "Incomplete Deal" } as any });
        expect.unreachable("Expected createDeal to throw ValidationError for missing fields");
      } catch (err: any) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.status).toBe(400);
        expect(err.errors.length).toBeGreaterThan(0);
      }

      // 2. Invalid data type (amount is a string)
      try {
        await createDeal({
          input: {
            title: "Type mismatch deal",
            amount: "five-thousand" as any,
            clientEmail: "test@example.com",
          },
        });
        expect.unreachable("Expected createDeal to throw ValidationError for string amount");
      } catch (err: any) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.status).toBe(400);
        expect(err.errors.length).toBeGreaterThan(0);
        const amountError = err.errors.find((e: any) => e.path === "/amount");
        expect(amountError).toBeDefined();
      }

      // 3. Schema constraint violation (negative amount)
      try {
        await createDeal({
          input: {
            title: "Negative amount deal",
            amount: -100,
            clientEmail: "test@example.com",
          },
        });
        expect.unreachable("Expected createDeal to throw ValidationError for negative amount");
      } catch (err: any) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.status).toBe(400);
        expect(err.errors.length).toBeGreaterThan(0);
      }

      // 4. Schema constraint violation (empty title)
      try {
        await createDeal({
          input: {
            title: "",
            amount: 1000,
            clientEmail: "test@example.com",
          },
        });
        expect.unreachable("Expected createDeal to throw ValidationError for empty title");
      } catch (err: any) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.status).toBe(400);
        expect(err.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe("listDeals", () => {
    it("should return the newly created deal when calling listDeals", async () => {
      // Create first deal
      const created1 = await createDeal({
        input: {
          title: "Deal Alpha",
          amount: 12000,
          clientEmail: "alpha@client.com",
        },
      });

      // Call listDeals
      const response1 = await listDeals({ input: {} });
      expect(response1.total).toBe(1);
      expect(response1.deals).toHaveLength(1);
      expect(response1.deals[0]).toEqual(created1);

      // Create second deal
      const created2 = await createDeal({
        input: {
          title: "Deal Beta",
          amount: 35000,
          clientEmail: "beta@client.com",
        },
      });

      // Call listDeals again
      const response2 = await listDeals({ input: {} });
      expect(response2.total).toBe(2);
      expect(response2.deals).toHaveLength(2);
      expect(response2.deals.map((d) => d.id)).toContain(created1.id);
      expect(response2.deals.map((d) => d.id)).toContain(created2.id);

      // Verify pagination limit
      const responsePaged = await listDeals({ input: { limit: 1 } });
      expect(responsePaged.total).toBe(2);
      expect(responsePaged.deals).toHaveLength(1);
      expect(responsePaged.deals[0].id).toBe(created1.id);
    });
  });

  describe("getDeal", () => {
    it("should retrieve deal by id successfully", async () => {
      const created = await createDeal({
        input: {
          title: "Target Deal",
          amount: 75000,
          clientEmail: "target@corp.com",
        },
      });

      const fetched = await getDeal({ input: { id: created.id } });
      expect(fetched).toEqual(created);
    });

    it("should throw ActionExecutionError with status 404 when deal is not found", async () => {
      try {
        await getDeal({ input: { id: "deal_non_existent" } });
        expect.unreachable("Expected getDeal to throw ActionExecutionError for missing deal");
      } catch (err: any) {
        expect(err).toBeInstanceOf(ActionExecutionError);
        expect(err.code).toBe("NOT_FOUND");
        expect(err.status).toBe(404);
      }
    });
  });

  describe("Service Introspection", () => {
    it("should register service and introspect metadata correctly", () => {
      const schema = dealsService.introspect();
      expect(schema.name).toBe("deals");
      expect(schema.hasDatabase).toBe(true);

      const actionNames = schema.actions.map((a) => a.name);
      expect(actionNames).toContain("createDeal");
      expect(actionNames).toContain("getDeal");
      expect(actionNames).toContain("listDeals");
    });
  });
});
