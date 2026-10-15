import { sqliteDatabase } from "@brickkit/crud/sqlite";
import { Effect, Layer } from "effect";

export interface CommentsDb {
  readonly CommentsDb: unique symbol;
}
export const Database = sqliteDatabase<CommentsDb>()(
  "example/comments/database",
  { filename: ":memory:" },
);
const initialize = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* Database.Service;
    yield* db.$client`CREATE TABLE pages (id TEXT PRIMARY KEY)`;
    yield* db.$client`CREATE TABLE comments (id TEXT PRIMARY KEY, target_id TEXT NOT NULL REFERENCES pages(id), body TEXT NOT NULL)`;
    yield* db.$client`INSERT INTO pages (id) VALUES ('page-1'), ('page-2')`;
  }),
);
export const DatabaseLive = initialize.pipe(Layer.provideMerge(Database.layer));
