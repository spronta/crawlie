// Prioritized "Top Fixes" — mirrors crawlie-core's priority::top_fixes so the
// app and the CLI/MCP rank fixes identically.

import type { Fix, Issue, Severity } from "./types";
import { ruleInfo } from "./rules";

const WEIGHT: Record<Severity, number> = { error: 5, warning: 2, notice: 0.6, good: 0 };

export function topFixes(issues: Issue[], limit = 5): Fix[] {
  const groups = new Map<string, { title: string; category: Issue["category"]; severity: Severity; count: number }>();
  for (const i of issues) {
    if (i.severity === "good") continue;
    const g = groups.get(i.rule) ?? { title: i.title, category: i.category, severity: i.severity, count: 0 };
    g.count++;
    groups.set(i.rule, g);
  }
  const fixes: Fix[] = [...groups.entries()].map(([rule, g]) => {
    const info = ruleInfo(rule);
    return {
      rule,
      title: g.title,
      category: g.category,
      severity: g.severity,
      count: g.count,
      impact: WEIGHT[g.severity] * Math.sqrt(g.count),
      why: info?.why ?? "",
      howToFix: info?.howToFix ?? "",
    };
  });
  fixes.sort((a, b) => b.impact - a.impact || b.count - a.count);
  return fixes.slice(0, limit);
}
