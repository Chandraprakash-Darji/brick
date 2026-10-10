# Resource plugin example

The comments factory uses `defineResourcePlugin` and attaches a `comments`
namespace to a parent resource. It explicitly receives the comment table and
installs CRUD with its own field policies. Parent identity comes from setup's
resource; comments validate that their target exists. The application owns
schema creation. This example uses one comment table per parent resource.

Run `bun run --cwd examples/extensions demo` to exercise compiled HTTP routes,
write hooks, list/count filters, local calls, and deletion.

The example implements an application plugin, not a published comments package.
A reusable package should accept typed column mappings, trusted access policies,
and route controls instead of assuming the example's table keys.
