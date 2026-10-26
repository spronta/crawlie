# crawlie

The fast, free, open-source technical **SEO + GEO** crawler — CLI and MCP server. [Read the CLI guide →](https://github.com/spronta/crawlie#how-to-use-cli)

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

### Help visitors find the content you just audited

Crawlie is built by **Spronta**, which adds Search, Answers and Content Analytics to your existing website.

[**Try free site search on your content →**](https://www.spronta.com/free-search/?utm_source=npm&utm_medium=readme&utm_campaign=crawlie-to-spronta&utm_content=package-quickstart) Search includes 10,000 requests per workspace each month. No credit card required. Answers and Analytics are separate paid products.

Crawlie runs locally under the MIT license. Spronta is an optional hosted service.

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

CLI guide: **[GitHub README](https://github.com/spronta/crawlie#how-to-use-cli)** · Source: [GitHub](https://github.com/spronta/crawlie) · by [Sean Ryan](https://linkedin.com/in/sean-exe). MIT.
