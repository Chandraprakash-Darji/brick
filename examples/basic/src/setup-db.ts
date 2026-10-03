import { syncSchema } from "@brick/core";
import { pagesDb } from "./services/pages/service";

// Explicit development setup command, never imported by server startup.
await syncSchema(pagesDb.tables, pagesDb.getDb());
