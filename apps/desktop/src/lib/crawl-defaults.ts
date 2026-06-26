// Global crawl defaults, persisted to localStorage and applied to every new
// crawl. The StartView still lets you override any of them per crawl.

import type { CrawlConfig } from "./types";
import { DEFAULT_CONFIG } from "./types";

/** The subset of crawl config saved as reusable defaults. */
export type CrawlDefaults = Pick<
  CrawlConfig,
  | "maxPages"
  | "maxDepth"
  | "concurrency"
  | "timeoutSecs"
  | "userAgent"
  | "checkExternal"
  | "respectRobots"
  | "useSitemap"
  | "render"
  | "renderWaitMs"
>;

const KEY = "crawl-defaults";

export const BUILTIN_DEFAULTS: CrawlDefaults = {
  maxPages: DEFAULT_CONFIG.maxPages,
  maxDepth: DEFAULT_CONFIG.maxDepth,
  concurrency: DEFAULT_CONFIG.concurrency,
  timeoutSecs: DEFAULT_CONFIG.timeoutSecs,
  userAgent: DEFAULT_CONFIG.userAgent,
  checkExternal: DEFAULT_CONFIG.checkExternal,
  respectRobots: DEFAULT_CONFIG.respectRobots,
  useSitemap: DEFAULT_CONFIG.useSitemap,
  render: DEFAULT_CONFIG.render,
  renderWaitMs: DEFAULT_CONFIG.renderWaitMs,
};

export function getCrawlDefaults(): CrawlDefaults {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...BUILTIN_DEFAULTS, ...(JSON.parse(raw) as Partial<CrawlDefaults>) };
  } catch {
    /* storage may be unavailable; ignore */
  }
  return { ...BUILTIN_DEFAULTS };
}

export function saveCrawlDefaults(d: CrawlDefaults) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}
