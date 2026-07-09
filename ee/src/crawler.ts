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

// --- Job-based crawl (decoupled from the request lifetime) --------------
// The container runs the crawl as a background task keyed by jobId; the Worker
// starts it and then polls status. This is what lets big sites finish: no
// single request is held open long enough to be evicted.

const jobContainer = (env: Env, jobId: string) => getContainer(env.CRAWLER, jobId);

/** Kick off a crawl job in its own container instance; returns immediately. */
export async function startJob(
  env: Env,
  jobId: string,
  config: unknown,
  packs: Array<{ name: string; source: string }>,
): Promise<void> {
  const res = await jobContainer(env, jobId).fetch(
    new Request("http://crawler/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, ...(config as Record<string, unknown>), packs }),
    }),
  );
  if (!res.ok) throw new Error(`Crawler start returned ${res.status}`);
}

export interface JobStatus {
  status: "running" | "done" | "saved" | "error" | "unknown";
  crawled?: number;
  discovered?: number;
  queued?: number;
  current?: string;
  result?: unknown;
  reportId?: string;
  message?: string;
}

/** Poll a crawl job. When `done`, `result` holds the report JSON (once). */
export async function pollJob(env: Env, jobId: string): Promise<JobStatus> {
  const res = await jobContainer(env, jobId).fetch(
    new Request(`http://crawler/status?job=${encodeURIComponent(jobId)}`),
  );
  if (!res.ok) throw new Error(`Crawler status returned ${res.status}`);
  return res.json<JobStatus>();
}

/** Record that the report was persisted; exactly-once (`first`) across polls. */
export async function finalizeJob(env: Env, jobId: string, reportId: string): Promise<{ first: boolean }> {
  const res = await jobContainer(env, jobId).fetch(
    new Request("http://crawler/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ job: jobId, reportId }),
    }),
  );
  if (!res.ok) return { first: false };
  return res.json<{ first: boolean }>();
}

// Cancel a running job (best-effort — the container stops the crawl).
export async function cancelCrawl(env: Env, id: string): Promise<void> {
  try {
    await jobContainer(env, id).fetch(
      new Request("http://crawler/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job: id }),
      }),
    );
  } catch {
    /* the instance will idle out on its own */
  }
}

/** Validate a pack + dry-run its custom checks against report pages (rule
 *  builder preview). One-shot request; the container replies with JSON. */
export async function previewPack(
  env: Env,
  source: string,
  pages: unknown[],
): Promise<unknown> {
  const container = getContainer(env.CRAWLER, "preview");
  const res = await container.fetch(
    new Request("http://crawler/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, pages }),
    }),
  );
  if (!res.ok) throw new Error(`Preview returned ${res.status}`);
  return res.json();
}
