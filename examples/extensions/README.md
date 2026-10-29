# Comments plugin example

`src/extensions/comments` is a plugin built with `definePlugin`. Installed with
`page.use(comments({ maxLength: 500 }))`, it:

- owns its table: `tables` builds `page_comments` for the host database's
  engine and adds it to the database, so `syncSchema(pagesService)` creates it;
- checks its typed options (`maxLength`, default 2000) when installed, and the
  Brick version it supports;
- requires `@brickkit/crud` on the host and subscribes to the host's CRUD
  lifecycle: deleting a page deletes its comments in the same transaction;
- adds a `pageComment` resource with CRUD routes under
  `/api/pages/page-comment`, attached as `page.comments`;
- declares `comments.added` in the host's event catalog;
- ships a dashboard extension (`dashboard.tsx`) that `brick dev` merges with
  the app's own.

Run `bun run --cwd examples/extensions demo` to exercise the compiled HTTP
routes, the write hooks, list and count filters, local calls, deletion and the
cascade.
