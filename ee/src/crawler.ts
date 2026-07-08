// Bridge from the Worker to the hosted crawl runtime: a Cloudflare Container
// running ee/crawler. We open one container request per crawl, stream its
// newline-delimited JSON, forward progress events to the caller, and return the
// final CrawlResult.

import { getContainer } from "@cloudflare/containers";
import type { Env } from "./env";

export async function runCrawl(
  env: Env,
  config: unknown,
  onEvent: (event: unknown) => void,
  packs: Array<{ name: string; source: string }> = [],
): Promise<unknown> {
  // A fresh container instance id per crawl keeps concurrent crawls isolated.
  const id = crypto.randomUUID();
  const container = getContainer(env.CRAWLER, id);

  const res = await container.fetch(
    new Request("http://crawler/crawl", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The container expects the CrawlConfig fields flattened, plus `packs`.
      body: JSON.stringify({ ...(config as Record<string, unknown>), packs }),
    }),
  );
  if (!res.ok || !res.body) throw new Error(`Crawler returned ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: unknown;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const obj = JSON.parse(line) as { type: string; result?: unknown; message?: string };
      if (obj.type === "result") result = obj.result;
      else if (obj.type === "error") throw new Error(obj.message ?? "crawl failed");
      else onEvent(obj);
    }
  }

  if (result === undefined) throw new Error("Crawler ended without a result.");
  return result;
}

// One container per crawl, so cancellation just lets the instance idle out.
export async function cancelCrawl(_env: Env, _id: string): Promise<void> {}
