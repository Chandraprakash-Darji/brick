import { sqliteStore } from "../src/native/store";
import { Effect, Context, Schema } from "effect";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { sqliteDatabase } from "../src/native/sqlite";
import {
  crud,
  type Conflict,
  type DatabaseFailure,
  type Forbidden,
  type InvalidInput,
} from "../src/native/crud";
interface Db {
  readonly Db: unique symbol;
}
interface OtherDb {
  readonly OtherDb: unique symbol;
}
const db = sqliteDatabase<Db>()("types/Db", { filename: ":memory:" });
const other = sqliteDatabase<OtherDb>()("types/Other", {
  filename: ":memory:",
});
const table = sqliteTable("types", {
  id: integer().primaryKey(),
  title: text().notNull(),
  secret: text(),
});
class CurrentUser extends Context.Service<CurrentUser, { id: string }>()(
  "types/User",
) {}
class Rejected extends Schema.TaggedError<Rejected>()("Rejected", {}) {}
const api = crud({
  table,
  id: "id",
  store: sqliteStore(table, db.Service),
  fields: {
    id: { read: true },
    title: { read: true, create: true, update: true },
    secret: {},
  },
  access: "public",
  hooks: {
    beforeCreate: ({ data }) =>
      Effect.gen(function* () {
        yield* CurrentUser;
        if (data.title === "reject") return yield* new Rejected();
        return data;
      }),
  },
});
const _effect: Effect.Effect<
  { id: number; title: string },
  Rejected | Conflict | DatabaseFailure | Forbidden | InvalidInput,
  Db | CurrentUser
> = api.create.handler({ title: "ok" });
// @ts-expect-error Missing request service requirement cannot disappear.
const _missing: Effect.Effect<{ id: number; title: string }, unknown, Db> =
  api.create.handler({ title: "ok" });
// @ts-expect-error Database identities must remain distinct.
const _wrong: typeof db.Service = other.Service;
// @ts-expect-error Non-writable fields cannot be passed to native handler.
api.create.handler({ title: "ok", secret: "leak" });
// @ts-expect-error Non-readable fields are absent from output.
const _hidden: Effect.Effect<{ secret: string }, unknown, Db | CurrentUser> =
  api.create.handler({ title: "ok" });
// @ts-expect-error No ID update policy is allowed to silently widen input.
api.update.handler({ id: 1, data: { id: 2 } });

// Read rows are exact: fields are required, never optional.
type Row = Effect.Success<ReturnType<typeof api.create.handler>>;
const _row: Row = { id: 1, title: "ok" };
// @ts-expect-error A read row cannot omit a readable field.
const _partial: Row = { title: "ok" };
