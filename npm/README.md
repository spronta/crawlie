# crawlie

The fast, free, open-source technical **SEO + GEO** crawler — CLI and MCP server. [Read the docs →](https://crawlie.dev/docs)

```bash
npm i -g crawlie
```

This installs two commands (the right prebuilt binary for your platform is pulled in automatically as an optional dependency — no download script, nothing to unblock):

- **`crawlie`** — crawl & audit any site from the command line
- **`crawlie-mcp`** — a Model Context Protocol server so agents can run audits

```bash
crawlie crawl https://example.com --format pretty     # crawl a whole site
crawlie audit https://example.com/pricing             # audit one page
crawlie crawl https://example.com --format html -o report.html
crawlie explain geo-not-answerable                    # why a finding matters
```

### Use with agents (MCP)

```jsonc
// claude_desktop_config.json (or any MCP client)
{
  "mcpServers": {
    "crawlie": { "command": "crawlie-mcp" }
  }
}
```

Tools: `crawl_site`, `audit_url`, `audit_urls`, `explain_issue`, `list_rules`, `list_reports`, `get_report`.

Supported: macOS (arm64/x64), Linux (x64), Windows (x64). Other platforms: [build from source](https://github.com/spronta/crawlie). The **desktop app** (signed `.dmg`) is a separate download on [Releases](https://github.com/spronta/crawlie/releases).

Docs: **[crawlie.dev/docs](https://crawlie.dev/docs)** · Source: [GitHub](https://github.com/spronta/crawlie) · by [Sean Ryan](https://linkedin.com/in/sean-exe). MIT.
