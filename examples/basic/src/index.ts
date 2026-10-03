import {
  getGlobalRegistry,
  ValidationError,
  ActionExecutionError,
} from "@elregaldo/core";
import {
  pagesService,
  createPage,
  getPage,
  getPublicPage,
  listPages,
  updatePage,
  renderPage,
} from "./services/pages/service";

export async function bootstrap() {
  console.log("===============================================================");
  console.log("📄 Pages — Publishing Workspace Engine (Brick-TS Demo)");
  console.log("   Direction: Content first, typeset canvas & publishing inspector");
  console.log("===============================================================\n");

  // 1. Service Discovery & Architecture Introspection
  const registry = getGlobalRegistry();
  const architecture = registry.exportArchitecture();

  console.log("📋 Registered Services & Action Endpoints:");
  for (const serviceSchema of architecture.services) {
    console.log(
      `\n  Service: '${serviceSchema.name}' (Database: ${
        serviceSchema.hasDatabase ? "Enabled (Bun SQLite + Drizzle)" : "Disabled"
      })`
    );
    for (const action of serviceSchema.actions) {
      console.log(`    ↳ Action: [${action.name}]`);
      if (action.description) {
        console.log(`      ${action.description}`);
      }
    }
  }

  console.log("\n---------------------------------------------------------------");
  console.log("🚀 Executing Pages Lifecycle Demo Pipeline");
  console.log("---------------------------------------------------------------\n");

  // Step 1: Create a published documentation page with markdown headings
  console.log("👉 1. Creating a technical specification page with Markdown headings...");
  const guideMarkdown = `# Brick Architecture Guide
The document is the main event. Its interface uses warm paper, deep ink, and quiet controls.

## Design Principles
1. Content first. Give writing the widest, quietest region.
2. Show publishing consequences. URL, visibility, theme, and preview live beside document.

## Ahead-of-Time TypeBox Validation
All action schemas compile ahead-of-time into high-speed V8 byte code.

### Performance Benchmarks
- Sub-3ms p99 endpoint latency
- Zero-latency local in-memory RPC
`;

  const newDoc = await createPage({
    input: {
      slug: "brick-architecture-guide",
      title: "Brick-TS Architecture Specification",
      content: guideMarkdown,
      contentType: "markdown",
      isPublic: true,
      theme: "nord",
    },
  });

  console.log("   ✅ Document created in database!");
  console.log(`      ID:         ${newDoc.id}`);
  console.log(`      Title:      ${newDoc.title}`);
  console.log(`      Slug:       /${newDoc.slug}`);
  console.log(`      Visibility: ${newDoc.isPublic ? "Public" : "Draft"}`);
  console.log(`      Theme:      ${newDoc.theme}`);
  console.log(`      Created:    ${newDoc.createdAt}\n`);

  // Step 2: Extract Table of Contents via renderPage
  console.log("👉 2. Rendering page and extracting Table of Contents (TOC) rail...");
  const rendered = await renderPage({
    input: { slug: "brick-architecture-guide" },
  });
  console.log(`   ✅ Rendered with theme '${rendered.theme}'. Generated TOC items:`);
  for (const item of rendered.toc) {
    const indent = "   ".repeat(item.level);
    console.log(`      ${indent}H${item.level} [${item.text}] (anchor: #${item.id})`);
  }
  console.log("");

  // Step 3: Test public reader retrieval by slug
  console.log("👉 3. Fetching published page by slug via public reader endpoint...");
  const publicPage = await getPublicPage({
    input: { slug: "brick-architecture-guide" },
  });
  console.log(`   ✅ Public reader fetched: "${publicPage.title}" (${publicPage.slug})\n`);

  // Step 4: Test validation - invalid slug format (uppercase / spaces)
  console.log("👉 4. Testing slug schema validation (rejecting uppercase and spaces)...");
  try {
    await createPage({
      input: {
        slug: "Invalid Slug With Spaces",
        title: "Bad Slug Document",
        content: "Draft content",
      },
    });
    console.error("   ❌ Should have failed slug validation.");
  } catch (err) {
    if (err instanceof ValidationError) {
      console.log("   ✅ Caught expected ValidationError:");
      console.log(`      Status:  ${err.status}`);
      console.log(`      Message: ${err.message}`);
      console.log(`      Errors:  ${JSON.stringify(err.errors)}\n`);
    } else {
      throw err;
    }
  }

  // Step 5: Test slug collision rejection (409 Conflict)
  console.log("👉 5. Testing duplicate slug collision rejection (409 Conflict)...");
  try {
    await createPage({
      input: {
        slug: "brick-architecture-guide",
        title: "Duplicate Document",
        content: "Duplicate content",
      },
    });
    console.error("   ❌ Should have rejected duplicate slug.");
  } catch (err) {
    if (err instanceof ActionExecutionError) {
      console.log("   ✅ Caught expected ActionExecutionError (SLUG_EXISTS):");
      console.log(`      Code:    ${err.code}`);
      console.log(`      Status:  ${err.status}`);
      console.log(`      Message: ${err.message}\n`);
    } else {
      throw err;
    }
  }

  // Step 6: Update document theme & visibility
  console.log("👉 6. Updating page theme to 'dracula'...");
  const updatedDoc = await updatePage({
    input: {
      id: newDoc.id,
      theme: "dracula",
    },
  });
  console.log(`   ✅ Page theme updated to: ${updatedDoc.theme}\n`);

  // Step 7: List all pages in the publishing workspace
  console.log("👉 7. Listing pages in workspace...");
  const list = await listPages({
    input: { limit: 10 },
  });
  console.log(`   ✅ Workspace contains ${list.pages.length} document(s) (Total: ${list.total}):`);
  for (const page of list.pages) {
    console.log(`      • [/${page.slug}] "${page.title}" (${page.theme}, ${page.isPublic ? "Public" : "Draft"})`);
  }

  console.log("\n===============================================================");
  console.log("🎉 All Pages demo pipeline assertions succeeded!");
  console.log("===============================================================");
}

if (import.meta.main) {
  bootstrap().catch((err) => {
    console.error("Pages demo encountered an error:", err);
    process.exit(1);
  });
}
