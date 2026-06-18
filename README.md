<div align="center">

# crawlie

**The fast, free, open-source technical SEO + GEO crawler.**

A Vercel-grade alternative to Screaming Frog and Sitebulb — built in Rust, runs on your machine, and is **built for agents**: one engine powers a desktop app, a CLI, and an MCP server.

*by [Spronta](https://spronta.com)*

</div>

---

## Why crawlie

Screaming Frog and Sitebulb are great — and dated. They're heavyweight desktop apps (JVM / .NET), they cost money to unlock, they have no agent story, and they audit yesterday's SEO. crawlie rethinks the category:

| | **crawlie** | Screaming Frog | Sitebulb |
|---|:---:|:---:|:---:|
| Price | **Free & open-source** | £259/yr to unlock | from £13.50/mo |
| Engine | **Rust, async, tiny binary** | Java (JVM) | .NET |
| Runs locally | ✅ | ✅ | ✅ |
| **CLI with JSON output** | ✅ | partial | ❌ |
| **MCP server (agent-native)** | ✅ | ❌ | ❌ |
| **GEO — AI/answer-engine audit** | ✅ | ❌ | ❌ |
| **"Why it matters" guidance built in** | ✅ every issue | ❌ | partial |
| Self-contained HTML report | ✅ | paid | ✅ |
| Whole-site **or** single-page / URL list | ✅ | ✅ | ✅ |
| Health + GEO scores | ✅ | ❌ | scores |
| Saved report history | ✅ | ✅ (project files) | ✅ |
| Source you can read & extend | ✅ | ❌ | ❌ |

The whole thing is one Rust crate (`crawlie-core`) wrapped by four thin surfaces. No lock-in, no per-seat pricing, and it's genuinely faster and lighter than either incumbent.

## What it checks — 46 rules and counting

**Technical SEO** — broken links · 4xx/5xx · redirects & chains · titles & meta descriptions (missing / duplicate / length) · H1s · canonicals · noindex / nofollow / X-Robots-Tag · robots.txt blocking · images missing alt · thin content · duplicate content (content-hash) · low text ratio · orphan & deep pages

**Performance & security** — slow responses · large pages · missing compression · HTTPS · mixed content · HSTS

**Mobile, international & social** — viewport · `lang` · hreflang · Open Graph · Twitter cards · structured data

**GEO — Generative Engine Optimization** *(new category nobody else has)* — whether your pages can be **cited by AI search** (ChatGPT, Perplexity, Google AI Overviews): structured data, semantic HTML, answer-readiness, authorship/E-E-A-T, dated content, question-style headings, and extractable blocks — rolled into a per-page **GEO score**.

Every finding links to plain-English guidance: **why it matters**, **how to fix it**, and **what happens if you ignore it**. crawlie teaches, it doesn't just report.

## Install

Requires [Rust](https://rustup.rs). Clone and build:

```bash
git clone https://github.com/spronta/crawlie
cd crawlie
cargo build --release
# binaries: target/release/crawlie  and  target/release/crawlie-mcp
```

## CLI

```bash
# Crawl a whole site (respects robots.txt, seeds from sitemap.xml)
crawlie crawl https://example.com --format pretty

# Audit one page, or a specific set of pages
crawlie audit https://example.com/pricing
crawlie audit https://example.com/a https://example.com/b

# Agent-friendly: clean JSON on stdout, gate CI on errors
crawlie crawl https://example.com --format json --fail-on error -o report.json

# Shareable, self-contained HTML report
crawlie crawl https://example.com --format html -o report.html

# Save to history, then browse it
crawlie crawl https://example.com --save
crawlie reports
crawlie report <id> --format html -o report.html

# Learn why any issue matters
crawlie explain geo-not-answerable
```

Useful flags: `--max-pages`, `--max-depth`, `--concurrency`, `--include <glob>`, `--exclude <glob>`, `--no-robots`, `--no-sitemap`, `--no-external`, `--severity error|warning|notice`.

## Agents & MCP

crawlie is built to be driven by LLM agents. Point any MCP client at the server:

```jsonc
// claude_desktop_config.json (or any MCP client)
{
  "mcpServers": {
    "crawlie": { "command": "/absolute/path/to/target/release/crawlie-mcp" }
  }
}
```

Tools exposed: **`crawl_site`**, **`audit_url`**, **`audit_urls`**, **`explain_issue`**, **`list_rules`**, **`list_reports`**, **`get_report`**. An agent can run a full technical + GEO audit, then ask `explain_issue` to understand and prioritise every finding — no human in the loop.

## Desktop app

A beautiful Tauri + React app (Geist design system, light/dark, seamless window chrome):

```bash
cd apps/desktop
pnpm install
pnpm tauri dev          # live native crawls
pnpm dev                # preview the UI in a browser (demo data, no backend)
```

Whole-site / single-page / URL-list modes, live progress, Health & GEO score rings, issues with built-in guidance, a sortable pages table, a per-page drawer (GEO signals, headers, schema, hreflang…), and an auto-saved report history.

> First run, generate the icon set: `cd src-tauri/icons && python3 generate.py && cd .. && pnpm tauri icon icons/source.png`

## Architecture

```
crates/
  crawlie-core    # the engine — crawl, audit, score, knowledge base, reports
  crawlie-cli     # `crawlie` — JSON / pretty / CSV / HTML output
  crawlie-mcp     # `crawlie-mcp` — Model Context Protocol server (stdio)
apps/
  desktop         # Tauri v2 + React (Geist) desktop app
```

`crawlie-core` has zero host dependencies — the same audited engine drops straight into a cloud worker (the crate already targets `wasm32`). One engine, every surface, identical results.

## Roadmap

- Cloud workers (shared Rust core) for scheduled/remote crawls
- JavaScript rendering for SPA-heavy sites
- Crawl-to-crawl comparison & regression alerts
- Sitemap & internal-link graph visualization

## License

MIT © Spronta
