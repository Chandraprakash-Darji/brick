# Database definitions

```ts
const appDb = defineDatabase({
  engine: "sqlite",
  path: secret("DB_PATH").default("./data/app.db"),
  tables: { pagesTable, user, session, account, verification },
});

const pages = defineService("pages", { database: appDb });
const another = defineService("another", { database: appDb });
// pages.getDb() === another.getDb() === appDb.getDb()
```

Each definition owns one lazily opened Drizzle instance. Use separate definitions
for isolated databases, or pass the same handle to services and auth adapters.
Services accept only `defineDatabase()` handles, not `true`, config objects, or
raw Drizzle instances. `setDb()` and `attachDatabase()` also accept handles only.
Resource databases come from their owning service.

SQLite accepts `path`/`filename`; PostgreSQL accepts `url`/`connectionString` or
individual connection fields. Engine-incompatible fields are rejected by types
and at runtime. Connection options accept literal values or typed `SecretRef`s.
Refs resolve and validate when opening the connection, not when importing a module.

Named `tables` preserve schema inference for `db.query`; arrays are also accepted.
An explicit `schema` can include Drizzle relations. Handles expose `tables` and
`schema` without opening a connection, for user-owned migration tooling.

**No runtime schema changes.** Declaring a database, registering a resource,
starting a server, and opening a connection do not create tables/indexes/FTS,
push schema, or run migrations. Run your chosen migration tooling explicitly
before serving requests. Schema/index/FTS helpers are available for explicit
development setup or test fixtures, never invoked automatically.
