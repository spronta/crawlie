// Web data layer — the `@platform/api` seam for the dashboard.
//
// Mirrors apps/desktop/src/lib/api.ts export-for-export so the reused views
// type-check and behave identically, but every call targets the HOSTED crawler
// API over HTTP instead of Tauri. Until the container backend is live (Phase 2),
// `HOSTED` is false and calls fall back to the shared demo data, so the whole
// UI is usable/previewable exactly like the desktop app's browser mode.

import type {
  CrawlConfig,
  CrawlDiff,
  CrawlEvent,
  CrawlResult,
  ReportMeta,
} from "@ui/lib/types";
import { DEMO_RESULT } from "@ui/lib/demo";

// Hosted crawler API base. The dashboard is served as static assets by the
// same Worker that hosts /v1, so same-origin ("") is correct in production —
// /v1 sends no CORS headers, and a cross-origin default here makes the browser
// silently block every credentialed call (reports "not found", web crawls
// failing) while the same-origin calls in cloud.ts keep working.
// VITE_CRAWLIE_API stays as a dev/preview override only.
const API = import.meta.env.VITE_CRAWLIE_API ?? "";
// Hosted crawler backend is live (crawlie.app/v1 → Cloudflare Container).
const HOSTED = true;

/** Always false on the web — kept so views can branch on desktop-only affordances. */
export function isTauri(): boolean {
  return false;
}

export async function openExternal(url: string): Promise<void> {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** No-op on the web (desktop uses it to drop macOS traffic-light spacing). */
export async function watchFullscreen(): Promise<() => void> {
  return () => {};
}

// Active team header (set by the dashboard team switcher). Inlined to avoid a
// circular import with cloud.ts.
function teamHeaders(): Record<string, string> {
  try {
    const t = localStorage.getItem("crawlie:team");
    return t ? { "x-crawlie-team": t } : {};
  } catch {
    return {};
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...teamHeaders(), ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

/** POST to a crawl endpoint and consume its SSE stream (progress events, then a
 *  final `result`). Shared by ad-hoc crawls and project crawls. Reading the body
 *  directly — EventSource can't POST. */
export async function streamCrawl(
  path: string,
  body: unknown,
  onEvent: (e: CrawlEvent) => void,
  projectId?: string,
): Promise<CrawlResult> {
  // Start the job (short request) — the crawl runs in the container regardless
  // of how long this browser session lasts.
  const start = await fetch(`${API}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", ...teamHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (start.status === 402) {
    const b = (await start.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? "Plan limit reached — upgrade to run more crawls.");
  }
  if (!start.ok) throw new Error(`Crawl failed (${start.status})`);
  const info = (await start.json()) as { jobId: string; maxPages?: number; capped?: boolean };
  const job = { jobId: info.jobId, cancelled: false };
  activeJob = job;
  if (typeof info.maxPages === "number") {
    onEvent({ type: "meta", maxPages: info.maxPages, capped: !!info.capped });
  }

  const q = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
  let misses = 0;
  for (;;) {
    if (job.cancelled) throw new Error("Crawl cancelled.");
    await new Promise((r) => setTimeout(r, 1200));
    if (job.cancelled) throw new Error("Crawl cancelled.");
    let st: {
      status: string;
      crawled?: number;
      discovered?: number;
      queued?: number;
      current?: string;
      reportId?: string;
      message?: string;
    };
    try {
      const r = await fetch(`${API}/v1/crawls/${encodeURIComponent(job.jobId)}${q}`, {
        credentials: "include",
        headers: teamHeaders(),
      });
      if (!r.ok) {
        if (++misses > 6) throw new Error(`Crawl status failed (${r.status})`);
        continue;
      }
      st = await r.json();
      misses = 0;
    } catch (e) {
      if (job.cancelled) throw new Error("Crawl cancelled.");
      if (++misses > 8) throw e;
      continue;
    }
    if (st.status === "running") {
      onEvent({
        type: "progress",
        crawled: st.crawled ?? 0,
        discovered: st.discovered ?? 0,
        queued: st.queued ?? 0,
        current: st.current ?? "",
      });
      continue;
    }
    if (st.status === "error") {
      throw new Error(st.message ?? "The crawl was interrupted. Please try again.");
    }
    if (st.status === "done" && st.reportId) {
      const report = await loadReport(st.reportId);
      if (!report) throw new Error("The report couldn't be loaded. Please try again.");
      return report;
    }
    if (++misses > 8) throw new Error("The crawl didn't finish. Please try again.");
  }
}

/** Start an ad-hoc hosted crawl. */
export async function startCrawl(
  config: CrawlConfig,
  onEvent: (e: CrawlEvent) => void,
): Promise<CrawlResult> {
  if (!HOSTED) return runDemo(config, onEvent);
  return streamCrawl("/v1/crawls", { config }, onEvent);
}

let activeJob: { jobId: string; cancelled: boolean } | null = null;
export async function cancelCrawl(): Promise<void> {
  const j = activeJob;
  activeJob = null;
  if (!j) return;
  j.cancelled = true;
  try {
    await fetch(`${API}/v1/crawls/${encodeURIComponent(j.jobId)}/cancel`, {
      method: "POST",
      credentials: "include",
      headers: teamHeaders(),
    });
  } catch {
    /* the container idles out on its own */
  }
}

export async function listReports(): Promise<ReportMeta[]> {
  if (!HOSTED) return DEMO_REPORTS;
  return req<ReportMeta[]>("/v1/reports");
}

export async function loadReport(id: string): Promise<CrawlResult | null> {
  if (!HOSTED) return id === DEMO_REPORTS[0].id ? DEMO_RESULT : null;
  try {
    return await req<CrawlResult>(`/v1/reports/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export async function deleteReport(id: string): Promise<void> {
  if (!HOSTED) return;
  await req(`/v1/reports/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function diffReports(oldId: string, newId: string): Promise<CrawlDiff | null> {
  if (!HOSTED) return DEMO_DIFF;
  try {
    return await req<CrawlDiff>(
      `/v1/diff?old=${encodeURIComponent(oldId)}&new=${encodeURIComponent(newId)}`,
    );
  } catch {
    return null;
  }
}

/** Hosted reports are already shareable via URL, so HTML export returns the
 *  report's public link rather than a local file path. */
export async function exportHtml(result: CrawlResult): Promise<string | null> {
  if (!HOSTED) return null;
  const id = `${result.startedAt}`;
  return `${API}/v1/reports/${encodeURIComponent(id)}/html`;
}

// ===== Settings (web: account-scoped, persisted server-side later) =====
export type Settings = { checkOnLaunch: boolean; autoUpdate: boolean };
const SETTINGS_KEY = "crawlie:settings";
const DEFAULT_SETTINGS: Settings = { checkOnLaunch: false, autoUpdate: false };

export async function getSettings(): Promise<Settings> {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export async function saveSettings(s: Settings): Promise<void> {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ===== Updates (desktop-only; inert on the web) =====
export type UpdateInfo = {
  version: string;
  notes?: string;
  install: (onProgress?: (pct: number) => void) => Promise<void>;
};
export async function appVersion(): Promise<string> {
  return "cloud";
}
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  return null;
}
export async function relaunchApp(): Promise<void> {}
export async function latestGithubRelease(): Promise<{ version: string; url: string } | null> {
  return null;
}

// ----- Shared demo data (until HOSTED) -----
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
    { rule: "title-missing", title: "Missing Title", category: "titles-meta", severity: "error", count: 2, sampleUrls: ["https://acme.example/pricing"] },
  ],
};

async function runDemo(config: CrawlConfig, onEvent: (e: CrawlEvent) => void): Promise<CrawlResult> {
  const result: CrawlResult = {
    ...DEMO_RESULT,
    config: { ...DEMO_RESULT.config, ...config, url: config.url || DEMO_RESULT.config.url },
  };
  const total = result.pages.length;
  onEvent({ type: "started", url: result.config.url });
  for (let i = 0; i < total; i++) {
    await new Promise((r) => setTimeout(r, 70));
    onEvent({ type: "progress", crawled: i + 1, discovered: total, queued: total - i - 1, current: result.pages[i].url });
  }
  await new Promise((r) => setTimeout(r, 160));
  onEvent({ type: "done", summary: result.summary });
  return result;
}
