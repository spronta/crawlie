// Bridge from the Worker to the hosted crawl runtime.
//
// Phase B wires this to a Cloudflare Container (the CRAWLER Durable Object)
// running the crawlie engine. Until that container is deployed, hosted crawling
// reports as provisioning so the API surface and storage can ship first.

import type { Env } from "./env";

export async function runCrawl(
  _env: Env,
  _config: unknown,
  _onEvent: (event: unknown) => void,
): Promise<never> {
  throw new Error("Hosted crawling is being provisioned — please try again shortly.");
}

export async function cancelCrawl(_env: Env, _id: string): Promise<void> {
  /* no-op until the container runtime is live */
}
