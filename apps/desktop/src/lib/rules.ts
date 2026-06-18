// The rule knowledge base, generated from crawlie-core (single source of truth).
// Regenerate with: crawlie-mcp list_rules -> src/lib/rules.json

import data from "./rules.json";
import type { RuleInfo } from "./types";

const RULES: Record<string, RuleInfo> = Object.fromEntries(
  (data as RuleInfo[]).map((r) => [r.rule, r])
);

export function ruleInfo(rule: string): RuleInfo | undefined {
  return RULES[rule];
}

export const ALL_RULES = data as RuleInfo[];
