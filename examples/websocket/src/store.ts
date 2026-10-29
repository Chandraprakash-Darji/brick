import {
  defineDatabase,
  sqliteTable,
  text,
  integer,
  syncSchema,
  eq,
  desc,
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

// Better Auth tables, including the anonymous plugin's isAnonymous column.
const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  isAnonymous: integer("is_anonymous", { mode: "boolean" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp_ms",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp_ms",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
export const authSchema = { user, session, account, verification };

const messages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  text: text("text").notNull(),
  at: text("at").notNull(),
});

export function createChatStore(path: string) {
  const database = defineDatabase({
    name: "chat",
    path,
    tables: { ...authSchema, messages },
  });
  const db = database.getDb();
  syncSchema(database.tables, db);
  return {
    database,
    db,
    save(userId: string, content: string): ChatMessage {
      const author = db.select().from(user).where(eq(user.id, userId)).get();
      if (!author) throw new Error("Chat user no longer exists");
      const saved = db
        .insert(messages)
        .values({ userId, text: content, at: new Date().toISOString() })
        .returning()
        .get();
      return { ...saved, name: author.name };
    },
    history(): ChatMessage[] {
      return db
        .select({
          id: messages.id,
          userId: user.id,
          name: user.name,
          text: messages.text,
          at: messages.at,
        })
        .from(messages)
        .innerJoin(user, eq(user.id, messages.userId))
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
