---
title: Skills & plugin
description: One-step Claude Code setup, and standalone Agent Skills that work anywhere.
section: Agents
order: 4
---

crawlie ships ready-made [Agent Skills](https://agentskills.io) and a Claude Code plugin
so an agent doesn't just *have* the tools — it knows *how* to run a real audit.

## One-step: the Claude Code plugin

The fastest path. The plugin bundles the MCP server **and** the audit skills in one
install. The MCP server auto-runs via `npx`, so you don't even need crawlie
pre-installed.

```bash
claude plugin marketplace add spronta/crawlie
claude plugin install crawlie@spronta
```

> MCP servers load at client startup, so the `crawlie` tools become available the next
> time you start Claude.

## Skills (work with any agent)

The skills are **self-contained**: they need neither the repo nor a pre-installed
crawlie. If the binary is missing, the skill runs it on demand via
`npx -y -p @spronta/crawlie` — and automatically prefers the MCP tools when they're
present.

| Skill | Use it to… |
|---|---|
| `seo-site-audit` | Run a full technical-SEO + GEO audit and get a prioritized fix list. |
| `fix-broken-links` | Find broken links, dead pages, and redirect chains, grouped by source. |
| `pre-launch-seo-check` | Gate a launch/deploy on a clear SEO pass/fail (and wire it into CI). |
| `geo-ai-readiness` | Assess and improve how citable a site is by AI search / LLMs. |

### Install a skill manually

Each skill is a portable folder (a `SKILL.md` plus any bundled files). Drop it into your
skills directory:

```bash
# user-level (all projects)
cp -R skills/seo-site-audit ~/.claude/skills/

# or project-level
mkdir -p .claude/skills && cp -R skills/seo-site-audit .claude/skills/
```

## How a skill picks its surface

In order:

1. **crawlie MCP tools** (`mcp__crawlie__*`) if present this session — fastest, structured.
2. **`crawlie` CLI** if it's already on `PATH`.
3. **`npx -y -p @spronta/crawlie crawlie …`** — on-demand; the install *is* the run.

So the skills work on a machine with nothing installed, and quietly upgrade to the MCP
when it's wired up.
