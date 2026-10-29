import {
  defineDatabase,
  sqliteTable,
  text,
  integer,
  syncSchema,
  eq,
  desc,
  and,
  gt,
  lt,
  sql,
  t,
  type Static,
} from "@brickkit/core";

export const chatMessage = t.Object({
  id: t.Integer(),
  userId: t.String(),
  name: t.String(),
  text: t.String({ maxLength: 2000 }),
  at: t.String(),
});
export type ChatMessage = Static<typeof chatMessage>;

const users = sqliteTable("chat_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});
const messages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  text: text("text").notNull(),
  at: text("at").notNull(),
});
const sessions = sqliteTable("chat_sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: integer("expires_at").notNull(),
});

export function createChatStore(path: string) {
  const database = defineDatabase({
    name: "chat",
    path,
    tables: { users, messages, sessions },
  });
  const db = database.getDb();
  syncSchema(database.tables, db);
  return {
    database,
    session(fingerprint: string) {
      return db.transaction((tx) => {
        let user = tx
          .select()
          .from(users)
          .where(eq(users.id, fingerprint))
          .get();
        if (!user) {
          const count =
            tx
              .select({ value: sql<number>`count(*)` })
              .from(users)
              .get()?.value ?? 0;
          user = tx
            .insert(users)
            .values({
              id: fingerprint,
              name: `Guest ${count + 1}`,
              createdAt: new Date().toISOString(),
            })
            .returning()
            .get();
        }
        tx.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
        const token = crypto.randomUUID();
        tx.insert(sessions)
          .values({
            token,
            userId: user.id,
            expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
          })
          .run();
        return { token, user };
      });
    },
    user(token: string) {
      return (
        db
          .select({ id: users.id, name: users.name })
          .from(sessions)
          .innerJoin(users, eq(users.id, sessions.userId))
          .where(
            and(eq(sessions.token, token), gt(sessions.expiresAt, Date.now())),
          )
          .get() ?? null
      );
    },
    save(userId: string, content: string): ChatMessage {
      const user = db.select().from(users).where(eq(users.id, userId)).get();
      if (!user) throw new Error("Chat user no longer exists");
      const saved = db
        .insert(messages)
        .values({ userId, text: content, at: new Date().toISOString() })
        .returning()
        .get();
      return { ...saved, name: user.name };
    },
    history(): ChatMessage[] {
      return db
        .select({
          id: messages.id,
          userId: users.id,
          name: users.name,
          text: messages.text,
          at: messages.at,
        })
        .from(messages)
        .innerJoin(users, eq(users.id, messages.userId))
        .orderBy(desc(messages.id))
        .limit(50)
        .all()
        .reverse();
    },
    close() {
      return database.close?.();
    },
  };
}
