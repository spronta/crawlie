// Bridge to the Rust backend. In a Tauri window this calls the native crawler
// and report store; in a plain browser (`pnpm dev`) it serves demo data so the
// UI stays fully previewable.

import type { CrawlConfig, CrawlDiff, CrawlEvent, CrawlResult, ReportMeta } from "./types";
import { DEMO_RESULT } from "./demo";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Open a URL in the user's default browser. In the desktop app a plain
 *  `<a target="_blank">` is blocked by the webview, so external links must go
 *  through the opener plugin; in browser preview we fall back to `window.open`. */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** Reflect the window's fullscreen state onto `<html data-fullscreen>` so CSS can
 *  drop the macOS traffic-light spacing in fullscreen. No-op in a browser. */
export async function watchFullscreen(): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const apply = async () => {
    try {
      const fs = await win.isFullscreen();
      document.documentElement.setAttribute("data-fullscreen", String(fs));
    } catch {
      /* window may be unavailable mid-transition; ignore */
    }
  };
  await apply();
  // Entering/leaving fullscreen fires a resize event.
  return win.onResized(apply);
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

/** Compare two saved crawls (oldId = the earlier one). Returns null if either
 *  report is missing. In browser preview, returns a demo diff. */
export async function diffReports(oldId: string, newId: string): Promise<CrawlDiff | null> {
  if (isTauri()) return invoke<CrawlDiff | null>("diff_reports", { oldId, newId });
  return DEMO_DIFF;
}

/** Render and save a shareable HTML report. Returns the saved file path, or null
 *  in browser preview (export is a desktop-app feature). */
export async function exportHtml(result: CrawlResult): Promise<string | null> {
  if (isTauri()) return invoke<string>("save_html_report", { result });
  return null;
}

const DAY = 86_400_000;
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
    a11yScore: DEMO_RESULT.summary.a11yScore,
  },
  // An older crawl of the same site, so the compare flow has two to diff.
  {
    id: DEMO_RESULT.startedAt - DAY + "-acme-example",
    url: DEMO_RESULT.config.url,
    createdAt: DEMO_RESULT.startedAt - DAY,
    totalPages: Math.max(0, DEMO_RESULT.summary.totalPages - 2),
    errors: DEMO_RESULT.summary.errors + 2,
    warnings: DEMO_RESULT.summary.warnings + 3,
    healthScore: Math.max(0, DEMO_RESULT.summary.healthScore - 9),
    geoScore: Math.max(0, DEMO_RESULT.summary.geoScore - 4),
    a11yScore: Math.max(0, DEMO_RESULT.summary.a11yScore - 6),
  },
];

const DEMO_DIFF: CrawlDiff = {
  oldId: DEMO_REPORTS[1].id,
  newId: DEMO_REPORTS[0].id,
  oldCreatedAt: DEMO_REPORTS[1].createdAt,
  newCreatedAt: DEMO_REPORTS[0].createdAt,
  healthBefore: DEMO_REPORTS[1].healthScore,
  healthAfter: DEMO_REPORTS[0].healthScore,
  healthDelta: DEMO_REPORTS[0].healthScore - DEMO_REPORTS[1].healthScore,
  geoBefore: DEMO_REPORTS[1].geoScore,
  geoAfter: DEMO_REPORTS[0].geoScore,
  geoDelta: DEMO_REPORTS[0].geoScore - DEMO_REPORTS[1].geoScore,
  a11yBefore: DEMO_REPORTS[1].a11yScore,
  a11yAfter: DEMO_REPORTS[0].a11yScore,
  a11yDelta: DEMO_REPORTS[0].a11yScore - DEMO_REPORTS[1].a11yScore,
  pagesBefore: DEMO_REPORTS[1].totalPages,
  pagesAfter: DEMO_REPORTS[0].totalPages,
  pagesAdded: ["https://acme.example/pricing", "https://acme.example/blog/whats-new"],
  pagesRemoved: ["https://acme.example/legacy-landing"],
  newIssues: [
    { rule: "broken-link", title: "Broken Link", category: "links", severity: "error", count: 1, sampleUrls: ["https://acme.example/blog/whats-new"] },
  ],
  resolvedIssues: [
    { rule: "title-missing", title: "Missing Title", category: "titles-meta", severity: "error", count: 2, sampleUrls: ["https://acme.example/pricing", "https://acme.example/about"] },
    { rule: "image-missing-alt", title: "Images Missing Alt Text", category: "images", severity: "warning", count: 4, sampleUrls: ["https://acme.example/"] },
    { rule: "description-missing", title: "Missing Meta Description", category: "titles-meta", severity: "warning", count: 1, sampleUrls: ["https://acme.example/features"] },
  ],
};

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
