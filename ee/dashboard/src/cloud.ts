// Crawlie Cloud API client — projects, history, trends, scheduled monitoring.
// Same-origin (crawlie.app/v1/*), reuses the shared crawl streamer + report
// loader from the platform seam.

import type { CrawlDiff, CrawlEvent, CrawlResult, ReportMeta } from "@ui/lib/types";
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
  notifyWebhook: string | null;
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
  packScore: number | null;
}

export function activeTeam(): string | null {
  try {
    return localStorage.getItem("crawlie:team");
  } catch {
    return null;
  }
}
export function setActiveTeam(id: string | null): void {
  try {
    if (id) localStorage.setItem("crawlie:team", id);
    else localStorage.removeItem("crawlie:team");
  } catch {
    /* ignore */
  }
}
export function teamHeaders(): Record<string, string> {
  const t = activeTeam();
  return t ? { "x-crawlie-team": t } : {};
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...teamHeaders() },
    ...init,
  });
  if (!res.ok) {
    let msg = `${path} → ${res.status}`;
    try {
      const b = (await res.json()) as { error?: string; code?: string };
      if (b.error) msg = b.error;
      const e = new Error(msg) as Error & { status?: number; code?: string };
      e.status = res.status;
      e.code = b.code;
      throw e;
    } catch (e) {
      if (e instanceof Error && (e as { status?: number }).status) throw e;
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

/** Screaming-Frog-style custom extractor: pull data via CSS selector (+ attr) or regex. */
export interface Extractor {
  name: string;
  css?: string;
  attr?: string;
  regex?: string;
}

export const listProjects = () => j<Project[]>("/v1/projects");
export const getProject = (id: string) => j<Project>(`/v1/projects/${id}`);
export const createProject = (input: {
  url: string;
  name?: string;
  schedule?: Schedule;
  notify?: boolean;
  config?: Record<string, unknown>;
}) => j<Project>("/v1/projects", { method: "POST", body: JSON.stringify(input) });
export const updateProject = (
  id: string,
  patch: { name?: string; schedule?: Schedule; notify?: boolean; notifyWebhook?: string | null; config?: Record<string, unknown> | null },
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

// Public sharing.
export const getShare = (id: string) => j<{ token: string | null }>(`/v1/reports/${id}/share`);
export const shareReport = (id: string) =>
  j<{ token: string; url: string }>(`/v1/reports/${id}/share`, { method: "POST" });
export const unshareReport = (id: string) =>
  j<{ ok: boolean }>(`/v1/reports/${id}/share`, { method: "DELETE" });
/** Compare two saved audits of the same site (Sitebulb-style diff). */
export async function diffReports(oldId: string, newId: string): Promise<CrawlDiff> {
  return j<CrawlDiff>(`/v1/diff?old=${encodeURIComponent(oldId)}&new=${encodeURIComponent(newId)}`);
}

export async function loadPublicReport(token: string): Promise<CrawlResult | null> {
  const res = await fetch(`${API}/pub/reports/${encodeURIComponent(token)}`);
  return res.ok ? ((await res.json()) as CrawlResult) : null;
}

// --- Teams + billing ---
export type Plan = "free" | "pro" | "business";
export interface PlanDef {
  id: Plan;
  label: string;
  priceMonthly: number;
  projects: number;
  crawlsPerMonth: number;
  scheduling: boolean;
  seats: number;
}
export interface Member {
  userId: string;
  role: string;
  email: string | null;
  name: string | null;
  joinedAt: number;
}
export interface TeamInfo {
  team: { id: string; name: string; plan: Plan; role: string; ownerId: string; stripeCustomer: string | null };
  plan: PlanDef;
  usage: { crawls: number; period: string };
  members: Member[];
  plans: Record<Plan, PlanDef>;
  billingEnabled: boolean;
}

export const getTeamInfo = () => j<TeamInfo>("/v1/team");
export const listTeams = () => j<Array<{ id: string; name: string; role: string; plan: Plan }>>("/v1/teams");
export const renameTeam = (name: string) => j<unknown>("/v1/team", { method: "PATCH", body: JSON.stringify({ name }) });
export const inviteMember = (email: string, role = "member") =>
  j<{ ok: boolean }>("/v1/team/invite", { method: "POST", body: JSON.stringify({ email, role }) });
export const removeMember = (userId: string) => j<{ ok: boolean }>(`/v1/team/members/${userId}`, { method: "DELETE" });
export const pendingInvites = () => j<Array<{ id: string; teamId: string; role: string; teamName: string }>>("/v1/invites");
export const acceptInvite = (id: string) => j<{ ok: boolean }>(`/v1/invites/${id}/accept`, { method: "POST" });
export const checkout = (plan: Plan) => j<{ url: string }>("/v1/billing/checkout", { method: "POST", body: JSON.stringify({ plan }) });
export const billingPortal = () => j<{ url: string }>("/v1/billing/portal", { method: "POST" });
export const deleteAccount = () => j<{ ok: boolean }>("/v1/account", { method: "DELETE" });

// --- Rule packs (marketing monitoring) ---
export interface RulePack {
  id: string;
  name: string;
  source: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
export const listPacks = () => j<RulePack[]>("/v1/packs");
export const createPack = (name: string, source: string) =>
  j<RulePack>("/v1/packs", { method: "POST", body: JSON.stringify({ name, source }) });
export const updatePack = (id: string, patch: { name?: string; source?: string; enabled?: boolean }) =>
  j<RulePack>(`/v1/packs/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const deletePack = (id: string) => j<{ ok: boolean }>(`/v1/packs/${id}`, { method: "DELETE" });

/** Rule-builder preview: validate pack source and dry-run its custom checks
 *  against a saved report's pages. */
export interface PackPreview {
  ok: boolean;
  error?: { line: number; col: number; message: string };
  checks?: number;
  contentRules?: number;
  pagesTested?: number;
  findings?: Array<{ rule: string; title: string; severity: "error" | "warning" | "notice"; url: string; detail: string }>;
}
export const previewPack = (source: string, reportId?: string) =>
  j<PackPreview>("/v1/packs/preview", { method: "POST", body: JSON.stringify({ source, reportId }) });

export const PACK_TEMPLATES: Array<{ name: string; label: string; description: string; source: string }> = [
  {
    name: "ai-slop",
    label: "AI slop detector",
    description: "Flags AI-cliché phrases that make copy sound generated.",
    source: `# AI slop / cliché detector — tune the weights to your voice.
phrase_rule("ai-cliches", weight = 3, phrases = [
    "in today's fast-paced world",
    "in the ever-evolving",
    "unlock the power of",
    "elevate your",
    "take your", "to the next level",
    "it's worth noting",
    "at the end of the day",
    "delve into", "dive into",
    "a testament to",
    "in conclusion",
])`,
  },
  {
    name: "banned-words",
    label: "Banned words",
    description: "Words your brand should never publish.",
    source: `# Words we never say
phrase_rule("banned", weight = 5, phrases = [
    "cheap",
    "guaranteed",
    "revolutionary",
    "world-class",
])`,
  },
  {
    name: "competitor-mentions",
    label: "Competitor mentions",
    description: "Flag pages that name competitors.",
    source: `# Competitor mentions
phrase_rule("competitors", weight = 4, phrases = [
    "screaming frog",
    "sitebulb",
    "ahrefs",
])`,
  },
];

export { loadReport };

export const SCHEDULE_LABEL: Record<Schedule, string> = {
  off: "Manual",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};
