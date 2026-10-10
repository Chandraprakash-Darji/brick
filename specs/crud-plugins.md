# Service and resource plugins

Baseline: local `beta` at `ec03a53`.
Branch: `feat/crud-plugins`.
Worktree: `/Users/rega/.t3/worktrees/brick-ts/feat-crud-plugins`.

## Commit boundaries

Commit 1 introduces the plugin author API, installation, scoped routes, typed
returned APIs, and HTTP exposure controls. Existing resources provide a resource
plugin host. Built-in CRUD, its endpoints, schemas, features, and compiler
optimizations stay as they are.

Commit 2 is deferred. It will move CRUD into the first framework plugin,
`@brickkit/crud`, installed with `service.use(crud()).resource(config)`. CRUD
endpoint design and capabilities will be reconsidered before that work starts.
The comments plugin, table mappings, operations controls, and generic compiler
preparation contributions for extracted CRUD are also deferred. No comments
package, schema mutation, CRUD extraction, or migration guide belongs in commit 1.

## Author and consumer API

Core exports `defineServicePlugin()` and `defineResourcePlugin()`. A descriptor
has a name, optional route controls, and a synchronous setup function. Factories
own their options and create descriptors; core does not introduce an options
builder or guess schemas.

```ts
import { defineService, defineServicePlugin, t } from "@brickkit/core";
import { brick } from "@brickkit/cli";

function greeting(
  options: {
    routes?:
      | false
      | {
          hello?: false | { path?: string; scope?: "app" | "service" };
        };
  } = {},
) {
  return defineServicePlugin({
    name: "example/greeting",
    routes: options.routes,
    setup({ routes }) {
      const hello = routes.action({
        name: "hello",
        method: "GET",
        path: "/hello",
        input: t.Object({ name: t.String() }),
        output: t.Object({ message: t.String() }),
        execute: ({ input }) => ({ message: `Hello ${input.name}` }),
      });
      return { hello };
    },
  });
}

const service = defineService("greetings");
const api = service.use(
  greeting({
    routes: {
      hello: { scope: "app", path: "/welcome" },
    },
  }),
);
export default brick({ services: [service], prefix: "/v1" });
// GET /v1/welcome?name=Ada
// Direct call: api.hello({ input: { name: "Ada" } })
```

Service setup receives `{ service, routes }` and returns its API. Resource setup
receives `{ service, resource, routes }` and returns named API contributions.
`resource.use(plugin)` mutates the resource with those contributions and returns
the resource extended with their inferred types. Preserve the returned value;
earlier variables do not retroactively gain static properties.

```ts
import { defineResourcePlugin, t } from "@brickkit/core";

const identity = defineResourcePlugin({
  name: "example/identity",
  setup({ resource, routes }) {
    const name = routes.action({
      name: "name",
      method: "GET",
      path: "/identity",
      output: t.String(),
      execute: () => resource.name,
    });
    return { identity: { name } };
  },
});
// Given an existing resource:
// const page = resource.use(identity);
// await page.identity.name({});
```

The action input, output, error and returned API types are inferred from the
schemas and setup return value. Table types survive resource installation and
chaining. A separately declared callback cannot acquire contextual types from a
later installation. Authors needing a particular database, service context or
resource use `ServicePluginContext<typeof service>` or
`ResourcePluginContext<typeof service, typeof resource>` on setup. Reusable
factories can declare their host constraints explicitly.

## Routes

`routes.action()` creates an ordinary validated local action plus a custom HTTP
binding. Its `name` is a stable local route key. It supports existing action
input/output schemas, errors, authorization and service context. HTTP bindings
use this metadata rather than also exposing an ordinary fallback action path.

`routes.endpoint()` registers a named raw handler. Its context has request,
params, query, body, headers, set, and `ctx`, the resolved service execution
context. Raw endpoints use existing response/error handling and appear in app
OpenAPI. They are outside the generated JSON browser client.

Scopes are `service`, `resource`, or `app`. Service is the default for service
plugins; resource is the default for resource plugins. Service plugins cannot
use resource scope. With prefix `/api`, path `/identity` resolves to
`/api/pages/identity`, `/api/page/identity`, or `/api/identity` respectively.
App scope never bypasses the configured prefix.

Consumers pass route controls through plugin factory options into the descriptor:

- `routes: false` disables every binding registered by that descriptor. It does
  not change independently installed dependency bindings. Configure dependencies
  through their own factory options.
- `routes: { hello: false }` disables one named route.
- `routes: { hello: { path: "/welcome", scope: "app" } }` overrides placement.
- Unknown override names, invalid paths and scopes fail registration.

A disabled route remains a callable local action. It is absent from HTTP
compilation, OpenAPI, and the generated browser client, including ordinary HTTP
fallback paths. Browser APIs come from enabled actions at their returned API
paths. Resource contributions appear under the resource namespace, such as
`api.page.identity.name`; service APIs appear under the service namespace.
An exposed action not returned by setup uses its scoped action name instead.
Capability disabling through `operations: false` will be designed alongside
CRUD in commit 2, separately from HTTP exposure.

## Identity, lifecycle and collisions

The same descriptor installed on the same host reuses its API before build.
A different descriptor with the same name fails, even if its options appear
equal. Reuse the descriptor to share one configured installation. The same
resource descriptor on separate resources runs setup independently. There is
no global deduplication and no option serialization/comparison.

Setup runs during installation and must be synchronous. Install dependencies
through `service.use()`; dependency cycles fail. Installation after service
build fails. Registrars close after setup, and building during setup fails.
Setup registers declarations. It must not mutate schemas, run migrations or
queries, open connections, or start background workers.

If setup fails, registrations made during that installation, its dependencies,
and resource contribution properties are restored. External side effects and
arbitrary mutations of user objects are outside this registration transaction.

Resource contributions cannot replace existing properties or contributions.
Duplicate named routes/actions fail. HTTP method/path collisions involving a
plugin fail at app construction, including equivalent parameterized paths,
raw endpoints, and built-in app routes. Existing legacy collision diagnostics
remain unchanged where no plugin is involved.

## Implementation and acceptance

1. Add descriptor/host types, identity tracking, setup transactions and resource
   contribution merging. Verify direct calls, identity, independent hosts,
   cycles, failure rollback and concrete API/schema/table type inference.
2. Feed generic plugin action binding metadata to route compilation, OpenAPI,
   and generated browser contracts. Use existing endpoint handling for raw
   routes. Test compiled and generic handlers with custom prefixes, app/service/
   resource scopes, disabled bindings, overrides, and collisions.
3. Update plugin overview and author docs with runnable non-CRUD examples.
   Remove the website's no-plugin claim. Existing `registerComments(service)`
   remains an application composition example until comments/CRUD are redesigned.
4. Run lint, formatting, build, typecheck and full existing tests. Delegate an
   independent review, fix accepted findings and rerun affected checks before
   committing this increment.

No new CRUD package or generic prepared-query infrastructure is required for
this increment. The eventual extraction should replace CRUD-specific core,
client and compiler branches with generic contributions while preserving or
explicitly revisiting optimized behavior after its next specification.
