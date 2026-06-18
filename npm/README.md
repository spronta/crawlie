# @spronta/crawlie

The fast, free, open-source technical **SEO + GEO** crawler — CLI and MCP server. By [Spronta](https://spronta.com).

```bash
npm i -g @spronta/crawlie
```

This installs two binaries (prebuilt, downloaded on install for your platform):

- **`crawlie`** — crawl & audit any site from the command line
- **`crawlie-mcp`** — a Model Context Protocol server so agents can run audits

```bash
# crawl a whole site
crawlie crawl https://example.com --format pretty

# audit one page (or a list)
crawlie audit https://example.com/pricing

# shareable HTML report
crawlie crawl https://example.com --format html -o report.html

# learn why any finding matters
crawlie explain geo-not-answerable
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

Supported platforms: macOS (arm64/x64), Linux (x64), Windows (x64). Other platforms: [build from source](https://github.com/spronta/crawlie).

Full docs & source: **https://github.com/spronta/crawlie** · by [Sean Ryan](https://linkedin.com/in/sean-exe).

MIT licensed.
