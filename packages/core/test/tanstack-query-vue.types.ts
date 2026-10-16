import { QueryClient, queryOptions, useQuery } from "@tanstack/vue-query";
import { computed, ref } from "vue";

import type { BrickClientAction } from "../src/client";
import { createBrickQueryClient } from "../src/tanstack-query";

const get: BrickClientAction<{ id: string }, { id: string }> = {
  kind: "action",
  name: "get",
  serviceName: "records",
  config: { method: "GET", path: "/records/:id" },
};
const api = createBrickQueryClient({
  baseUrl: "https://example.test",
  contract: { records: { get } },
});

// Checked by tsc, without invoking Vue composables outside a setup scope.
function vueQueryConsumer() {
  const id = ref("1");
  const options = api.records.get.queryOptions({ input: { id: id.value } });
  const plain = useQuery(options);
  const reactive = useQuery(
    computed(() => ({
      ...api.records.get.queryOptions({ input: { id: id.value } }),
      enabled: !!id.value,
    })),
  );
  const selected = useQuery(
    queryOptions({ ...options, select: (data) => data.id }),
  );
  const plainId: string | undefined = plain.data.value?.id;
  const reactiveId: string | undefined = reactive.data.value?.id;
  const selectedId: string | undefined = selected.data.value;
  // @ts-expect-error Query results retain the action's output type.
  const invalidId: number = plain.data.value!.id;
  // @ts-expect-error Required action input remains required.
  api.records.get.queryOptions();

  const cache = new QueryClient();
  const cached = cache.getQueryData(
    api.records.get.queryKey({ input: { id: "1" } }),
  );
  const cachedId: string | undefined = cached?.id;
  // @ts-expect-error Cache data retains the action's output type through DataTag.
  const invalidCachedId: number = cached!.id;
  void [plainId, reactiveId, selectedId, invalidId, cachedId, invalidCachedId];
}
void vueQueryConsumer;
