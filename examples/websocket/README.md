# Typed WebSockets

Run from the repository root after `bun install` and `bun run build`:

```sh
bun run --cwd examples/websocket dev
```

Open `http://localhost:5178` in two browser sessions, then:

1. Click **Join conversation** in each window. This identifies the browser, creates a demo session, and opens its WebSocket.
2. Send a message from either window. Both receive it. Your own messages show **You**; the other window shows a guest name.
3. Leave the room in one window. Its messages stop updating, and the other window's participant count drops.
4. Refresh and join again, or restart the backend. Stored messages return, with the same browser identity.

The dark chat UI uses the supplied design tokens, system fonts, and Hugeicons. Messages appear only after the server sends them back. Inspect `/api/chat/live` under DevTools → Network → WS to see the frames.

The application broadcasts to every connected client in this server process. It commits messages to SQLite before broadcasting and loads the latest 50 on join, in small frames that fit the socket limit. All messages remain in the database. The history and broadcast policies belong to this application, not the socket transport.

## Identity and storage

[FingerprintJS](https://github.com/fingerprintjs/fingerprintjs) computes a browser fingerprint locally, with its monitoring request disabled. That fingerprint is the SQLite user ID. A returning fingerprint gets the same guest name. Separate tabs or similar browser profiles may share an identity, and browser changes can change it. The fingerprint identifies a demo user; it is not an authentication secret or an account system.

The backend sets an opaque HttpOnly session cookie. SQLite holds users, sessions, and messages in `examples/websocket/.brick/chat.sqlite` when you use the command above. The file is ignored by Git. Override its location with `BRICK_CHAT_DB`:

```sh
BRICK_CHAT_DB=/absolute/path/chat.sqlite bun run --cwd examples/websocket dev
```

This is a shared public demo room. For a private application, replace the demo session endpoint with your authentication flow.

The backend runs on Bun at port 4000. Vite proxies upgrades and the session endpoint to it. `brick dev` generates `_brick/contract.ts` before starting Vite and regenerates the contract on backend edits. The dev dashboard's Overview lists the socket route, both event directions, and its authorization policy.

```sh
bun run --cwd examples/websocket typecheck
bun run --cwd examples/websocket build
```

The build produces the frontend bundle. Production hosting must proxy `/api` WebSocket upgrades and `/session` to a running Bun backend.
