---
title: MCP server
description: Let an AI agent run a full audit and act on it — no human in the loop.
section: Agents
order: 3
---

crawlie ships a [Model Context Protocol](https://modelcontextprotocol.io) server so an
LLM agent can crawl a site, read structured issues, and turn them into fixes. This is the
part most SEO tools don't have.

## Connect it

After `npm i -g @spronta/crawlie`, `crawlie-mcp` is on your `PATH`.

**Claude Code:**

```bash
claude mcp add crawlie crawlie-mcp
```

**Claude Desktop** — edit `claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "crawlie": {
      "command": "crawlie-mcp"
    }
  }
}
```

Any MCP-compatible client works — Cursor, Cline, or your own agent. It speaks JSON-RPC
over stdio. Built from source? Use the absolute path to `target/release/crawlie-mcp`.

> Prefer one-step setup? The [Claude Code plugin](/docs/skills-and-plugin) bundles this
> MCP server (auto-run via `npx`) together with ready-made audit skills.

## Tools exposed

| Tool | Purpose |
|---|---|
| `crawl_site` | Crawl + audit a whole site (SEO + GEO); returns scores, issues, per-page data. |
| `audit_url` | Audit a single page. |
| `audit_urls` | Audit an explicit list of pages. |
| `explain_issue` | Why a rule matters + how to fix it. |
| `list_rules` | The full catalogue of checks. |
| `list_reports` / `get_report` | Read saved crawl history. |

## Example agent prompts

> "Crawl example.com, then give me the top 5 fixes that would most improve my GEO score,
> with the exact change for each."

> "Audit these three landing pages and tell me which is least ready to be cited by AI
> search, and why."

> "Run a crawl with `--fail-on error` semantics — are there any broken links or 5xx pages
> blocking launch?"

The agent calls `crawl_site`, reads the structured issues, and uses `explain_issue` to
turn findings into a prioritized, actionable plan.
