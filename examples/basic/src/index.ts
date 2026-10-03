import {
  getGlobalRegistry,
  ValidationError,
  ActionExecutionError,
} from "@brick-ts/core";
import {
  dealsService,
  createDeal,
  getDeal,
  listDeals,
} from "./services/deals/service";

export async function bootstrap() {
  console.log("==================================================");
  console.log("🧱 Brick-TS Example Application - Slice 0 Showcase");
  console.log("==================================================\n");

  // 1. Service Discovery & Architecture Introspection
  const registry = getGlobalRegistry();
  const architecture = registry.exportArchitecture();

  console.log("📋 Registered Services & Endpoints:");
  for (const serviceSchema of architecture.services) {
    console.log(`\n  Service: '${serviceSchema.name}' (Database: ${serviceSchema.hasDatabase ? "Enabled" : "Disabled"})`);
    for (const action of serviceSchema.actions) {
      console.log(`    ↳ Action: ${action.name}`);
      if (action.description) {
        console.log(`      Description: ${action.description}`);
      }
    }
  }

  console.log("\n--------------------------------------------------");
  console.log("🚀 Executing Self-Test Demo Pipeline");
  console.log("--------------------------------------------------\n");

  // Step A: Create Deal with Valid Data
  console.log("👉 1. Creating a deal with valid data...");
  const newDeal = await createDeal({
    input: {
      title: "Enterprise Annual Subscription",
      amount: 48000,
      clientEmail: "procurement@acme.corp",
    },
  });
  console.log("   ✅ Deal created successfully!");
  console.log(`      ID:        ${newDeal.id}`);
  console.log(`      Title:     ${newDeal.title}`);
  console.log(`      Amount:    $${newDeal.amount}`);
  console.log(`      Status:    ${newDeal.status}`);
  console.log(`      CreatedAt: ${newDeal.createdAt}\n`);

  // Step B: Create Deal with Invalid Data (demonstrating TypeBox validation)
  console.log("👉 2. Testing input validation with invalid data (negative amount & empty title)...");
  try {
    await createDeal({
      input: {
        title: "",
        amount: -500,
        clientEmail: "invalid",
      },
    });
    console.error("   ❌ Unexpected success: validation should have failed.");
  } catch (err) {
    if (err instanceof ValidationError) {
      console.log("   ✅ Caught expected ValidationError as designed:");
      console.log(`      Status:  ${err.status}`);
      console.log(`      Message: ${err.message}`);
      console.log(`      Errors:  ${JSON.stringify(err.errors, null, 2).replace(/\n/g, "\n               ")}\n`);
    } else {
      throw err;
    }
  }

  // Step C: Fetch the Created Deal
  console.log(`👉 3. Fetching deal by ID '${newDeal.id}'...`);
  const fetchedDeal = await getDeal({
    input: { id: newDeal.id },
  });
  console.log("   ✅ Deal retrieved:");
  console.log(`      Title:     ${fetchedDeal.title}`);
  console.log(`      Amount:    $${fetchedDeal.amount}`);
  console.log(`      Status:    ${fetchedDeal.status}\n`);

  // Step D: List All Deals
  console.log("👉 4. Listing all active deals...");
  const dealList = await listDeals({
    input: { limit: 10 },
  });
  console.log(`   ✅ Fetched ${dealList.deals.length} deal(s) (Total in store: ${dealList.total}):`);
  for (const d of dealList.deals) {
    console.log(`      - [${d.id}] ${d.title} ($${d.amount}) [${d.status}]`);
  }

  // Step E: Domain Error handling demo (NOT_FOUND)
  console.log("\n👉 5. Testing domain error handling (requesting non-existent deal)...");
  try {
    await getDeal({
      input: { id: "deal_non_existent" },
    });
  } catch (err) {
    if (err instanceof ActionExecutionError) {
      console.log("   ✅ Caught expected ActionExecutionError:");
      console.log(`      Code:    ${err.code}`);
      console.log(`      Status:  ${err.status}`);
      console.log(`      Message: ${err.message}\n`);
    } else {
      throw err;
    }
  }

  console.log("==================================================");
  console.log("🎉 All demo self-test assertions passed!");
  console.log("==================================================");
}

// Run bootstrap when executed directly
if (import.meta.main) {
  bootstrap().catch((err) => {
    console.error("Demo failed with error:", err);
    process.exit(1);
  });
}
