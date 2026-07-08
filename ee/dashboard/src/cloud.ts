// Crawlie Cloud API client — projects, history, trends, scheduled monitoring.
// Same-origin (crawlie.app/v1/*), reuses the shared crawl streamer + report
// loader from the platform seam.

import type { CrawlEvent, ReportMeta } from "@ui/lib/types";
import { streamCrawl, loadReport } from "@platform/api";

const API = import.meta.env.VITE_CRAWLIE_API ?? "";

export type Schedule = "off" | "daily" | "weekly" | "monthly";

export interface Project {
  id: string;
  name: string;
  url: string;
  config: Record<string, unknown> | null;
  schedule: Schedule;
  notify: boolean;
  nextRunAt: number | null;
  lastCrawlAt: number | null;
  lastHealth: number | null;
  lastReport: string | null;
  createdAt: number;
}

export interface TrendPoint {
  id: string;
  at: number;
  health: number;
  geo: number;
  a11y: number;
  errors: number;
  warnings: number;
  pages: number;
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const listProjects = () => j<Project[]>("/v1/projects");
export const getProject = (id: string) => j<Project>(`/v1/projects/${id}`);
export const createProject = (input: {
  url: string;
  name?: string;
  schedule?: Schedule;
  notify?: boolean;
}) => j<Project>("/v1/projects", { method: "POST", body: JSON.stringify(input) });
export const updateProject = (
  id: string,
  patch: { name?: string; schedule?: Schedule; notify?: boolean },
) => j<Project>(`/v1/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const deleteProject = (id: string) =>
  j<{ ok: boolean }>(`/v1/projects/${id}`, { method: "DELETE" });
export const projectReports = (id: string) => j<ReportMeta[]>(`/v1/projects/${id}/reports`);
export const projectTrend = (id: string) => j<TrendPoint[]>(`/v1/projects/${id}/trend`);

/** Run a crawl for a project, streaming progress; server records the history. */
export const crawlProject = (id: string, onEvent: (e: CrawlEvent) => void) =>
  streamCrawl(`/v1/projects/${id}/crawls`, undefined, onEvent);

export interface ApiKeyMeta {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}
export const listKeys = () => j<ApiKeyMeta[]>("/v1/keys");
export const createKey = (name: string) =>
  j<ApiKeyMeta & { key: string }>("/v1/keys", { method: "POST", body: JSON.stringify({ name }) });
export const revokeKey = (id: string) => j<{ ok: boolean }>(`/v1/keys/${id}`, { method: "DELETE" });

export { loadReport };

export const SCHEDULE_LABEL: Record<Schedule, string> = {
  off: "Manual",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};
