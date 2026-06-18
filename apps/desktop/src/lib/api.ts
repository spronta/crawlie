// Bridge to the Rust backend. In a Tauri window this calls the native crawler
// and report store; in a plain browser (`pnpm dev`) it serves demo data so the
// UI stays fully previewable.

import type { CrawlConfig, CrawlEvent, CrawlResult, ReportMeta } from "./types";
import { DEMO_RESULT } from "./demo";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type Unlisten = () => void;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Start a crawl, streaming progress via `onEvent`. Resolves with the result. */
export async function startCrawl(
  config: CrawlConfig,
  onEvent: (e: CrawlEvent) => void
): Promise<CrawlResult> {
  if (isTauri()) {
    const { listen } = await import("@tauri-apps/api/event");
    const un: Unlisten = await listen<CrawlEvent>("crawl-event", (ev) => onEvent(ev.payload));
    try {
      return await invoke<CrawlResult>("start_crawl", { config });
    } finally {
      un();
    }
  }
  return runDemo(config, onEvent);
}

export async function cancelCrawl(): Promise<void> {
  if (isTauri()) await invoke("cancel_crawl");
}

export async function listReports(): Promise<ReportMeta[]> {
  if (isTauri()) return invoke<ReportMeta[]>("list_reports");
  return DEMO_REPORTS;
}

export async function loadReport(id: string): Promise<CrawlResult | null> {
  if (isTauri()) return invoke<CrawlResult | null>("load_report", { id });
  return id === DEMO_REPORTS[0].id ? DEMO_RESULT : null;
}

export async function deleteReport(id: string): Promise<void> {
  if (isTauri()) await invoke("delete_report", { id });
}

const DEMO_REPORTS: ReportMeta[] = [
  {
    id: DEMO_RESULT.startedAt + "-acme-example",
    url: DEMO_RESULT.config.url,
    createdAt: DEMO_RESULT.startedAt,
    totalPages: DEMO_RESULT.summary.totalPages,
    errors: DEMO_RESULT.summary.errors,
    warnings: DEMO_RESULT.summary.warnings,
    healthScore: DEMO_RESULT.summary.healthScore,
    geoScore: DEMO_RESULT.summary.geoScore,
  },
];

// ----- Browser demo (no backend) -----
async function runDemo(config: CrawlConfig, onEvent: (e: CrawlEvent) => void): Promise<CrawlResult> {
  const result: CrawlResult = {
    ...DEMO_RESULT,
    config: { ...DEMO_RESULT.config, ...config, url: config.url || DEMO_RESULT.config.url },
  };
  const total = result.pages.length;
  onEvent({ type: "started", url: result.config.url });
  for (let i = 0; i < total; i++) {
    await new Promise((r) => setTimeout(r, 80));
    onEvent({ type: "progress", crawled: i + 1, discovered: total, queued: total - i - 1, current: result.pages[i].url });
  }
  await new Promise((r) => setTimeout(r, 180));
  onEvent({ type: "done", summary: result.summary });
  return result;
}
