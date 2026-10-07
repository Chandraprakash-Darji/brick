# @brickkit/core

Core engine primitives for the Brick-TS framework: typed services, actions,
resources, databases (SQLite/Postgres via Drizzle), secrets, and pub/sub —
all validated with TypeBox and runnable on Bun or Node.

```sh
bun add @brickkit/core drizzle-orm postgres
```

```ts
import { defineDatabase } from "@brickkit/core";
import { pgTable, text } from "@brickkit/core/pg";

const pages = pgTable("pages", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
});

export const db = defineDatabase({
  engine: "postgres",
  tables: { pages },
  url: process.env.DATABASE_URL!,
});
```

Bun-only APIs are lazy-loaded, so the package imports cleanly under
strict Node ESM too. Source: <https://github.com/Chandraprakash-Darji/brick>.
