// The rule knowledge base, generated from crawlie-core (single source of truth).
// Regenerate with: crawlie-mcp list_rules -> src/lib/rules.json

import data from "./rules.json";
import type { RuleInfo } from "./types";

const RULES: Record<string, RuleInfo> = Object.fromEntries(
  (data as RuleInfo[]).map((r) => [r.rule, r])
);

// User-defined check rules from the loaded report (Pro rule packs). One report
// renders at a time, so a module registry keeps every ruleInfo() call site
// (issue groups, top fixes) working unchanged for custom rules.
let CUSTOM: Record<string, RuleInfo> = {};

export function setCustomRules(infos: RuleInfo[] | undefined): void {
  CUSTOM = Object.fromEntries((infos ?? []).map((r) => [r.rule, r]));
}

export function ruleInfo(rule: string): RuleInfo | undefined {
  return CUSTOM[rule] ?? RULES[rule];
}

export const ALL_RULES = data as RuleInfo[];
