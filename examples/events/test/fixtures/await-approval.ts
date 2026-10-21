import { createWebhook } from "workflow";

/** Waits for one request to its own webhook, and answers with the request body. */
export async function awaitApproval(_event: unknown) {
  "use workflow";
  const webhook = createWebhook();
  await publish(webhook.url);
  const request = await webhook;
  const body = (await request.json()) as { approved: boolean };
  await finish(body);
  return body;
}

export const seen: { url?: string; body?: { approved: boolean } } = {};

async function publish(url: string) {
  "use step";
  seen.url = url;
}

async function finish(body: { approved: boolean }) {
  "use step";
  seen.body = body;
}
