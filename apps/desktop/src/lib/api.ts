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

/** Render and save a shareable HTML report. Returns the saved file path, or null
 *  in browser preview (export is a desktop-app feature). */
export async function exportHtml(result: CrawlResult): Promise<string | null> {
  if (isTauri()) return invoke<string>("save_html_report", { result });
  return null;
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

// ===== Settings =====

export type Settings = { checkOnLaunch: boolean; autoUpdate: boolean };
const DEFAULT_SETTINGS: Settings = { checkOnLaunch: true, autoUpdate: false };
const SETTINGS_KEY = "crawlie:settings";

export async function getSettings(): Promise<Settings> {
  if (isTauri()) return invoke<Settings>("get_settings");
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  if (isTauri()) {
    await invoke("set_settings", { settings: s });
    return;
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ===== Updates =====

/** The current app version (Tauri build version, or "dev" in the browser). */
export async function appVersion(): Promise<string> {
  if (!isTauri()) return "dev";
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return "dev";
  }
}

export type UpdateInfo = {
  version: string;
  notes?: string;
  /** Download + install the update, reporting 0–100% progress. */
  install: (onProgress?: (pct: number) => void) => Promise<void>;
};

/** Check for an update via the Tauri updater plugin. Returns null when no update
 *  is available, when not in Tauri, or when the updater isn't configured yet
 *  (e.g. dev builds with no signing key) — callers can fall back to a link. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body ?? undefined,
      install: async (onProgress) => {
        let total = 0;
        let got = 0;
        await update.downloadAndInstall((ev) => {
          if (ev.event === "Started") {
            total = ev.data.contentLength ?? 0;
          } else if (ev.event === "Progress") {
            got += ev.data.chunkLength;
            if (total && onProgress) onProgress(Math.min(100, Math.round((got / total) * 100)));
          } else if (ev.event === "Finished") {
            onProgress?.(100);
          }
        });
      },
    };
  } catch {
    return null;
  }
}

/** Relaunch the app to finish applying an installed update. */
export async function relaunchApp(): Promise<void> {
  if (!isTauri()) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Fallback used when the updater plugin isn't configured: a plain GitHub
 *  release lookup so users still get a download link. */
export async function latestGithubRelease(): Promise<{ version: string; url: string } | null> {
  try {
    const res = await fetch("https://api.github.com/repos/spronta/crawlie/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const version = String(data.tag_name || "").replace(/^v/, "");
    return version ? { version, url: data.html_url } : null;
  } catch {
    return null;
  }
}

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
