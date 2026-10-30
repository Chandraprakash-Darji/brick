# Typed WebSockets

Run from the repository root after `bun install` and `bun run build`:

```sh
bun run --cwd examples/websocket dev
```

Open `http://localhost:5178` in two browser sessions, then:

1. Click **Join conversation** in each window. This signs the browser in as an anonymous guest with Better Auth and opens its WebSocket.
2. Send a message from either window. Both receive it. Your own messages show **You**; the other window shows a guest name.
3. Leave the room in one window. Its messages stop updating, and the other window's participant count drops.
4. Refresh and join again, or restart the backend. Stored messages return, with the same guest identity while the session cookie lasts.

The dark chat UI uses the supplied design tokens, system fonts, and Hugeicons. Messages appear only after the server sends them back. Inspect `/api/chat/live` under DevTools → Network → WS to see the frames.

Every connection is in the socket room `chat:lobby`, and the application emits to it with `live.emit()`. It commits messages to SQLite before emitting and loads the latest 50 on join, in small frames that fit the socket limit. All messages remain in the database. The history policy belongs to this application, not the socket transport.

## Identity and storage

[Better Auth](https://www.better-auth.com) with its [anonymous plugin](https://www.better-auth.com/docs/plugins/anonymous) signs each browser in as a guest with a random ID and name. Better Auth serves `/api/auth/*` and sets its session cookie; the socket's context resolver reads that session during the handshake and before every message. Tabs in one browser share a guest; another browser or a private window gets a new one. To let guests keep their history, add a real sign-in method and link it with the plugin's `onLinkAccount` hook.

Set `BETTER_AUTH_SECRET` outside local development. Set `BETTER_AUTH_URL` when the frontend is not served from `http://localhost:5178`. SQLite holds the Better Auth tables and messages in `examples/websocket/.brick/chat.sqlite` when you use the command above. The file is ignored by Git. Override its location with `BRICK_CHAT_DB`:

```sh
BRICK_CHAT_DB=/absolute/path/chat.sqlite bun run --cwd examples/websocket dev
```

This is a shared public demo room. For a private application, require a non-anonymous sign-in in `authorize`.

The backend runs on Bun at port 4000. Vite proxies `/api`, including WebSocket upgrades and Better Auth routes, to it. `brick dev` generates `_brick/contract.ts` before starting Vite and regenerates the contract on backend edits. The dev dashboard's Overview lists the socket route, both event directions, and its authorization policy.

```sh
bun run --cwd examples/websocket typecheck
bun run --cwd examples/websocket build
```

The build produces the frontend bundle. Production hosting must proxy `/api`, including WebSocket upgrades, to a running Bun backend.
