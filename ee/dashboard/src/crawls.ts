// Global registry of running crawls. Crawl lifecycles live here — at module
// level, not inside a view — so navigating away doesn't orphan the polling
// loop: the sidebar can badge running crawls, ProjectView can show inline
// progress, and /new can be left and revisited mid-crawl.

import { useSyncExternalStore } from "react";
import type { CrawlConfig, CrawlEvent, CrawlResult } from "@ui/lib/types";
import { DEFAULT_CONFIG } from "@ui/lib/types";
import type { Progress } from "@ui/views/CrawlingView";
import { startCrawl, resumeCrawl } from "@platform/api";
import { crawlProject, listRunningCrawls, type Project, type RunningCrawl } from "./cloud";
import { toast } from "./ui-kit";

export interface ActiveCrawl {
  key: string; // "project:<id>" | "adhoc"
  projectId?: string;
  config: CrawlConfig;
  progress: Progress;
  startedAt: number;
  cancel: () => void;
}

/** Terminal state of the ad-hoc (/new) crawl, kept until the user resets. */
export type AdhocResult =
  | { status: "done"; result: CrawlResult }
  | { status: "error"; message: string };

let crawls: ActiveCrawl[] = [];
let adhoc: AdhocResult | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useCrawls(): ActiveCrawl[] {
  return useSyncExternalStore(subscribe, () => crawls);
}
export function useProjectCrawl(projectId: string): ActiveCrawl | undefined {
  return useCrawls().find((c) => c.projectId === projectId);
}
export function useAdhocCrawl(): { running?: ActiveCrawl; finished: AdhocResult | null } {
  const running = useCrawls().find((c) => c.key === "adhoc");
  const finished = useSyncExternalStore(subscribe, () => adhoc);
  return { running, finished };
}
export function clearAdhocResult(): void {
  adhoc = null;
  emit();
}

function update(key: string, patch: (c: ActiveCrawl) => Partial<ActiveCrawl>) {
  crawls = crawls.map((c) => (c.key === key ? { ...c, ...patch(c) } : c));
  emit();
}
function remove(key: string) {
  crawls = crawls.filter((c) => c.key !== key);
  emit();
}

/** Register the entry and wire cancel + progress plumbing shared by both flows. */
function track(key: string, config: CrawlConfig, projectId?: string, startedAt?: number) {
  let cancelRequested = false;
  let jobCancel: (() => Promise<void>) | null = null;
  const entry: ActiveCrawl = {
    key,
    projectId,
    config,
    progress: { crawled: 0, discovered: 0, queued: 0, current: config.url },
    startedAt: startedAt ?? Date.now(),
    cancel: () => {
      cancelRequested = true;
      void jobCancel?.();
    },
  };
  crawls = [...crawls, entry];
  emit();
  const onJob = (job: { cancel: () => Promise<void> }) => {
    jobCancel = job.cancel;
    if (cancelRequested) void job.cancel(); // cancelled before the job id arrived
  };
  const onEvent = (e: CrawlEvent) => {
    if (e.type === "progress") {
      update(key, () => ({ progress: { crawled: e.crawled, discovered: e.discovered, queued: e.queued, current: e.current } }));
    } else if (e.type === "meta") {
      // Server may cap maxPages to the plan limit — reflect it so progress/ETA stay honest.
      update(key, (c) => ({ config: { ...c.config, maxPages: e.maxPages } }));
    }
  };
  return { onEvent, onJob, wasCancelled: () => cancelRequested };
}

/** Completion wiring for a project crawl (started or resumed). */
function settleProjectCrawl(key: string, run: Promise<CrawlResult>, wasCancelled: () => boolean): void {
  run
    .then(() => toast("Crawl complete", "success"))
    .catch((e) => {
      if (!wasCancelled()) toast((e as Error).message, "error");
    })
    .finally(() => remove(key));
}

/** Completion wiring for the ad-hoc crawl (started or resumed). */
function settleAdhocCrawl(run: Promise<CrawlResult>, wasCancelled: () => boolean): void {
  run
    .then((result) => {
      adhoc = { status: "done", result };
      toast("Crawl complete", "success");
    })
    .catch((e) => {
      // A user-initiated cancel just returns to the start screen.
      adhoc = wasCancelled() ? null : { status: "error", message: e instanceof Error ? e.message : String(e) };
    })
    .finally(() => remove("adhoc")); // remove() emits, so the adhoc result renders
}

/** Start (or join) the crawl for a project. No-op if one is already running. */
export function startProjectCrawl(project: Project): void {
  const key = `project:${project.id}`;
  if (crawls.some((c) => c.key === key)) return;
  const config: CrawlConfig = {
    ...DEFAULT_CONFIG,
    ...((project.config ?? {}) as Partial<CrawlConfig>),
    url: project.url,
  };
  const { onEvent, onJob, wasCancelled } = track(key, config, project.id);
  settleProjectCrawl(key, crawlProject(project.id, onEvent, onJob), wasCancelled);
}

/** Start the ad-hoc (/new) crawl. No-op if one is already running. */
export function startAdhocCrawl(config: CrawlConfig): void {
  if (crawls.some((c) => c.key === "adhoc")) return;
  adhoc = null;
  const { onEvent, onJob, wasCancelled } = track("adhoc", config);
  settleAdhocCrawl(startCrawl(config, onEvent, onJob), wasCancelled);
}

/** Reattach to crawls the server says are still running — a page reload loses
 *  the in-memory store, but the container jobs keep going without us. Called
 *  once when the dashboard mounts; each job rejoins the normal poll loop. */
let resumeStarted = false;
export async function resumeRunningCrawls(): Promise<void> {
  if (resumeStarted) return;
  resumeStarted = true;
  let rows: RunningCrawl[] = [];
  try {
    rows = await listRunningCrawls();
  } catch {
    return; // best-effort: the API may be unreachable (dev) or the user signed out
  }
  let adhocSeen = false;
  for (const r of rows) {
    const key = r.projectId ? `project:${r.projectId}` : "adhoc";
    if (!r.projectId) {
      // The /new view shows a single ad-hoc crawl; resume only the newest.
      if (adhocSeen) continue;
      adhocSeen = true;
    }
    if (crawls.some((c) => c.key === key)) continue;
    const config: CrawlConfig = { ...DEFAULT_CONFIG, url: r.url, maxPages: r.maxPages };
    const { onEvent, onJob, wasCancelled } = track(key, config, r.projectId ?? undefined, r.startedAt);
    const run = resumeCrawl(r.jobId, r.maxPages, onEvent, r.projectId ?? undefined, onJob);
    if (r.projectId) settleProjectCrawl(key, run, wasCancelled);
    else settleAdhocCrawl(run, wasCancelled);
  }
}
