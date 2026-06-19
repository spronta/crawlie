# crawlie Agent Skills

Standalone [Agent Skills](https://agentskills.io) that let any Claude agent run real
technical-SEO and AI-search audits with [crawlie](https://github.com/spronta/crawlie).

**Each skill is fully self-contained.** It does **not** require the crawlie source repo,
and it does **not** require crawlie to be pre-installed. The skill bootstraps crawlie
from npm on first use (`npx -y -p @spronta/crawlie …`), which downloads and caches the
right native binary automatically. The only prerequisite on the user's machine is
[Node](https://nodejs.org) — or, even better, the crawlie MCP server already registered.

## The skills

| Skill | Use it when you want to… |
|---|---|
| [`seo-site-audit`](seo-site-audit/SKILL.md) | Run a full technical SEO + GEO audit and get a prioritized fix list. |
| [`fix-broken-links`](fix-broken-links/SKILL.md) | Find broken links, dead pages, and redirect chains, grouped by source. |
| [`pre-launch-seo-check`](pre-launch-seo-check/SKILL.md) | Gate a launch/deploy on a clear SEO pass/fail (and wire it into CI). |
| [`geo-ai-readiness`](geo-ai-readiness/SKILL.md) | Assess and improve how citable a site is by AI search / LLMs. |

## How they pick a surface (in order)

1. **crawlie MCP tools** (`mcp__crawlie__*`) if they exist in the session — fastest, structured.
2. **`crawlie` CLI** if it's already on `PATH`.
3. **`npx -y -p @spronta/crawlie crawlie …`** — on-demand; this *is* the install, no setup.

A skill cannot make MCP tools appear mid-session (MCP servers load at client startup),
so the skills drive the CLI by default and use the MCP automatically when it's present.
They each offer a one-time "install for good" upgrade (`npm i -g @spronta/crawlie` +
`claude mcp add crawlie crawlie-mcp`) without blocking the task on it.

## Install

**Claude Code** — copy a skill folder into your skills directory:

```bash
# user-level (all projects)
cp -R skills/seo-site-audit ~/.claude/skills/

# or project-level
mkdir -p .claude/skills && cp -R skills/seo-site-audit .claude/skills/
```

Or publish/install them through an Agent Skills marketplace. Each folder
(`SKILL.md` + any bundled files) is the complete, portable unit.

## Best paired with the MCP

For the first-class experience, register the crawlie MCP once:

```bash
npm i -g @spronta/crawlie
claude mcp add crawlie crawlie-mcp
```

Then the skills use the structured `crawl_site` / `audit_url` / `explain_issue` tools
directly. Without it, they still work — just via the CLI.
