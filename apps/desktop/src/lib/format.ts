import type { Severity } from "./types";

export function statusClass(status: number): string {
  if (status === 0) return "status-0";
  if (status >= 500) return "status-5xx";
  if (status >= 400) return "status-4xx";
  if (status >= 300) return "status-3xx";
  return "status-2xx";
}

export function statusLabel(status: number): string {
  return status === 0 ? "ERR" : String(status);
}

export function severityRank(s: Severity): number {
  return s === "error" ? 2 : s === "warning" ? 1 : 0;
}

export function ms(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}s`;
  return `${n}ms`;
}

export function bytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1000) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    return path === "/" ? u.host : path;
  } catch {
    return url;
  }
}

export function num(n: number): string {
  return n.toLocaleString("en-US");
}
