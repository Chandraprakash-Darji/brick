# @brickkit/lint

Lint rules that keep every [Brick](https://brickkit.dev) app laid out the same way and away from common bugs: one action per `*.action.ts` file, services in their own folders, no cross-service table access, explicit access on every action, and more.

It ships as an ESLint flat-config plugin, which oxlint loads through its JS plugin support, and powers the `brick lint` command of `@brickkit/cli`.

```bash
bun add -d @brickkit/lint oxlint
brick lint
```

## Presets

- `recommended`: the bug and security rules. On by default.
- `layout`: the file-structure rules.
- `strict`: `recommended`, plus style, docs and test rules.
- `plugin`: rules for plugin packages.

Choose them in `brick.config.ts`:

```ts
import { defineConfig } from "@brickkit/cli";

export default defineConfig({
  lint: {
    presets: ["recommended", "layout"],
    rules: { "brick/test-colocated": "warn" },
    ignore: ["src/legacy/**"],
  },
});
```

`brick/no-cross-service-tables` is always an error.

## ESLint

```js
// eslint.config.js
import tseslint from "typescript-eslint";
import brick from "@brickkit/lint";

export default [
  ...tseslint.configs.recommended,
  ...(await brick.configs.fromProject()),
];
```

Or a preset on its own: `brick.configs.recommended`, `layout`, `strict`, `plugin`.

## oxlint

Tested with oxlint 1.88, whose JS plugins are alpha. The TypeScript config runs in Node 22.18 or later:

```ts
// oxlint.config.ts
import { defineConfig } from "oxlint";
import brick from "@brickkit/lint";

export default defineConfig(
  await brick.configs.fromProject({ linter: "oxlint" }),
);
```

## File rules and app rules

File rules check one file and run in the editor. App rules (`single-app-entry`, `no-cross-service-tables`, `unique-names`, `declared-events`, `test-colocated`) need the loaded app, so only `brick lint` runs them.

Every rule is described in the [lint docs](https://brickkit.dev/docs/brick-cli/lint).

## License

MIT
