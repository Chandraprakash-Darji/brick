import { describe, it, expect, beforeEach } from "bun:test";
import {
  defineService,
  sqliteTable,
  text,
  integer,
  t,
} from "@brick-ts/core";
import { createBrickServer } from "../src/server";

const notesTable = sqliteTable("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
  userId: text("user_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

describe("REST Route Binding for Resources (@brick-ts/cli)", () => {
  let notesService: ReturnType<typeof defineService>;
  let app: ReturnType<typeof createBrickServer>;

  beforeEach(() => {
    notesService = defineService("notes_svc", {
      database: true,
    });

    notesService.resource({
      name: "note",
      table: notesTable,
      ownerField: "userId",
      operations: {
        list: { defaultLimit: 20, maxLimit: 100 },
        get: true,
        create: true,
        update: true,
        delete: true,
      },
    });

    // Custom action with path parameters
    notesService.action({
      name: "customLookup",
      path: "/api/notes-custom/:noteId",
      input: t.Object({ noteId: t.String() }),
      execute: async ({ input }) => {
        return { customNoteId: input.noteId, handled: true };
      },
    });

    app = createBrickServer({ services: [notesService] });
  });

  it("should mount /api/note (POST, GET) and /api/note/:id (GET, PATCH, DELETE)", async () => {
    // 1. POST /api/note
    const postRes = await app.handle(
      new Request("http://localhost:4000/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "My First Note",
          content: "Remember the milk",
          isPinned: true,
        }),
      })
    );
    expect(postRes.status).toBe(200);
    const createdNote = await postRes.json();
    expect(createdNote.id).toBeDefined();
    expect(createdNote.title).toBe("My First Note");
    expect(createdNote.isPinned).toBe(true);

    // 2. GET /api/note (list with query coercion)
    const listRes = await app.handle(
      new Request("http://localhost:4000/api/note?isPinned=true&limit=5")
    );
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.total).toBe(1);
    expect(listData.notes[0].title).toBe("My First Note");

    // 3. GET /api/note/:id
    const getRes = await app.handle(
      new Request(`http://localhost:4000/api/note/${createdNote.id}`)
    );
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.id).toBe(createdNote.id);
    expect(fetched.content).toBe("Remember the milk");

    // 4. PATCH /api/note/:id
    const patchRes = await app.handle(
      new Request(`http://localhost:4000/api/note/${createdNote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "Remember oat milk",
        }),
      })
    );
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.content).toBe("Remember oat milk");

    // 5. Custom route with path param: /api/notes-custom/:noteId
    const customRes = await app.handle(
      new Request(`http://localhost:4000/api/notes-custom/${createdNote.id}`)
    );
    expect(customRes.status).toBe(200);
    const customData = await customRes.json();
    expect(customData.customNoteId).toBe(createdNote.id);
    expect(customData.handled).toBe(true);

    // 6. DELETE /api/note/:id
    const deleteRes = await app.handle(
      new Request(`http://localhost:4000/api/note/${createdNote.id}`, {
        method: "DELETE",
      })
    );
    expect(deleteRes.status).toBe(200);
    const deleteData = await deleteRes.json();
    expect(deleteData.success).toBe(true);

    // 7. Verify deletion via GET /api/note/:id -> 404
    const notFoundRes = await app.handle(
      new Request(`http://localhost:4000/api/note/${createdNote.id}`)
    );
    expect(notFoundRes.status).toBe(404);
  });
});
