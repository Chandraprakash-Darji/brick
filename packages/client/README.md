# @brickkit/client

Typed clients for Brick (or any Effect `HttpApi`) servers.

```ts
import { createClient } from "@brickkit/client";
import { Api } from "./contract";

const { client, ready, dispose } = createClient(Api, {
  baseUrl: "https://api.example.com",
  fetchOptions: { credentials: "include" },
});

const page = await client.pages["page.get"]({ params: { id: "p1" } });
```

- `createClient` is synchronous. The native client builds in the background:
  `ready` settles when it is built (or rejects with the layer's failure), and
  the first call surfaces the same failure.
- Methods return Promises and are typed from the contract: request parts,
  decoded success type, and endpoint names.
- `dispose()` closes the scoped runtime and releases layer resources.
- Rejections carry the declared error instances (for example `NotFound`), so
  `instanceof` works. TypeScript cannot type rejection values.
- Pass `layer` to supply client middleware services when the API requires them.

`createEffectClient` is `HttpApiClient.make`, for Effect applications that want
typed error channels instead of rejections.
