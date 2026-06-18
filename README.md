<div align="center">

# crawlie

**The fast, free, open-source technical SEO + GEO crawler — built for humans and agents.**

Crawl any site for broken links, redirects, missing metadata, and 40+ SEO & Generative-Engine checks — with plain-English guidance on every fix. Runs locally, ships a CLI and an MCP server, and costs nothing.

[![npm](https://img.shields.io/npm/v/@spronta/crawlie?color=cb3837&logo=npm&label=%40spronta%2Fcrawlie)](https://www.npmjs.com/package/@spronta/crawlie)
[![CI](https://github.com/spronta/crawlie/actions/workflows/ci.yml/badge.svg)](https://github.com/spronta/crawlie/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<p>
  <a href="#setup">Setup</a> ·
  <a href="#how-to-use-cli">CLI</a> ·
  <a href="#use-with-agents-mcp">MCP &amp; agents</a> ·
  <a href="#use-cases">Use cases</a> ·
  <a href="#why-i-built-this">Why I built this</a> ·
  <a href="#desktop-app">Desktop app</a> ·
  <a href="#what-it-checks">Checks</a> ·
  <a href="#how-it-compares">Compare</a> ·
  <a href="#architecture">Architecture</a>
</p>

*by [Spronta](https://spronta.com)*

</div>

---

## Setup

**The easy way — npm** (installs the `crawlie` CLI and the `crawlie-mcp` server):

```bash
npm i -g @spronta/crawlie
```

**The macOS app** — grab the signed `.dmg` from [Releases](https://github.com/spronta/crawlie/releases).

**From source** — needs [Rust](https://rustup.rs) (engine/CLI/MCP) and, for the desktop app, [pnpm](https://pnpm.io) + Node:

```bash
git clone https://github.com/spronta/crawlie
cd crawlie
cargo build --release
# → target/release/crawlie  and  target/release/crawlie-mcp

# or install onto your PATH:
cargo install --path crates/crawlie-cli      # installs `crawlie`
cargo install --path crates/crawlie-mcp      # installs `crawlie-mcp`
```

> **How it ships:** the **CLI + MCP** come *only* through npm — the right native binary installs automatically as a platform package (nothing to download or unblock). The **desktop app** is the only direct download: a Spronta-signed, notarized `.dmg` on [Releases](https://github.com/spronta/crawlie/releases).

---

## How to use (CLI)

```bash
# Crawl a whole site (respects robots.txt, seeds from sitemap.xml)
crawlie crawl https://example.com --format pretty

# Audit a single page, or a specific set of pages
crawlie audit https://example.com/pricing
crawlie audit https://example.com/a https://example.com/b

# Save a shareable, self-contained HTML report
crawlie crawl https://example.com --format html -o report.html

# Clean JSON on stdout (perfect for piping / scripting / agents)
crawlie crawl https://example.com --format json -o report.json

# Learn why any finding matters and how to fix it
crawlie explain geo-not-answerable
```

**Output formats:** `pretty` (terminal), `json` (machine-readable, the default), `csv` (issues), `html` (shareable file).

**Common flags:**

| Flag | What it does |
|---|---|
| `--max-pages <n>` | Cap pages fetched (default 500) |
| `--max-depth <n>` | Max click depth from the seed |
| `--concurrency <n>` | Parallel requests (default 16) |
| `--include <glob>` / `--exclude <glob>` | Scope the crawl by URL pattern |
| `--no-robots` / `--no-sitemap` / `--no-external` | Turn off robots.txt, sitemap seeding, external link checks |
| `--severity error\|warning\|notice` | Only output findings at/above a level |
| `--save` | Save to local report history (`crawlie reports`, `crawlie report <id>`) |
| `--fail-on error\|warning` | Non-zero exit code for CI gating |

Every crawl returns two scores: a **Health** score (technical SEO) and a **GEO** score (AI-search readiness).

---

## Use with agents (MCP)

crawlie ships a [Model Context Protocol](https://modelcontextprotocol.io) server so an LLM agent can run a full audit and act on it — no human in the loop. This is the part most SEO tools don't have.

### Connect it

After `npm i -g @spronta/crawlie`, `crawlie-mcp` is on your `PATH`. For **Claude Desktop**, edit `claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "crawlie": {
      "command": "crawlie-mcp"
    }
  }
}
```

For **Claude Code**:

```bash
claude mcp add crawlie crawlie-mcp
```

(If you built from source instead, use the absolute path to `target/release/crawlie-mcp`.)

(Any MCP-compatible client works — Cursor, Cline, your own agent. It speaks JSON-RPC over stdio.)

### Tools exposed

| Tool | Purpose |
|---|---|
| `crawl_site` | Crawl + audit a whole site (SEO + GEO), returns scores, issues, per-page data |
| `audit_url` | Audit a single page |
| `audit_urls` | Audit an explicit list of pages |
| `explain_issue` | Why a rule matters + how to fix it |
| `list_rules` | The full catalogue of checks |
| `list_reports` / `get_report` | Read saved crawl history |

### Example agent prompts

> *"Crawl spronta.com, then give me the top 5 fixes that would most improve my GEO score, with the exact change for each."*

> *"Audit these three landing pages and tell me which is least ready to be cited by AI search, and why."*

> *"Run a crawl with `--fail-on error` semantics — are there any broken links or 5xx pages blocking launch?"*

The agent calls `crawl_site`, reads the structured issues, and uses `explain_issue` to turn findings into a prioritized, actionable plan.

---

## Use cases

- **Pre-launch QA** — catch broken links, redirects, 4xx/5xx, and missing metadata before you ship.
- **GEO optimization** — make pages citable by AI search: structured data, semantic HTML, answer-ready content, authorship/E-E-A-T.
- **Agent workflows** — let a marketing/SEO agent audit a site and propose fixes autonomously via MCP.
- **CI/CD gating** — `crawlie crawl … --fail-on error` in a pipeline to block regressions.
- **Client reporting** — generate a polished, shareable HTML report in one command.
- **Auditing AI-generated sites** — verify that the site your agent just built is actually built for search.

---

## Why I built this

I'm **Sean Ryan**. I've spent 6+ years at **Pendo.io** as a Lead Marketing Engineer and lead engineer, and on the side I'm building **[Spronta](https://spronta.com)** — AI for marketers.

With AI, it's faster than ever to ship a marketing site — but most of what gets generated is slop that was never built to be found. And the tools meant to catch that fall short: most SEO auditors cost money, don't play nicely with your agents, or tell you *what's* wrong without telling you *how to actually rank* for SEO **and** GEO (Generative Engine Optimization — being cited by AI search like ChatGPT, Perplexity, and Google AI Overviews).

crawlie fixes that. It's free, it's local-first, it's agent-native, and every issue it finds comes with *why it matters* and *how to fix it*.

**If this is useful to you, [connect with me on LinkedIn →](https://linkedin.com/in/sean-exe)** — I share what I'm learning building AI for marketers and SEO/GEO tooling, and I'd love to hear how you're using crawlie.

---

## Desktop app

A beautiful Tauri + React app (Geist design, light/dark, seamless window chrome):

```bash
cd apps/desktop
pnpm install
pnpm tauri dev          # live native crawls
pnpm dev                # preview the UI in a browser (demo data, no backend)
```

Whole-site / single-page / URL-list modes, live progress, **Health** & **GEO** score rings, issues with built-in *why-it-matters* guidance, a sortable pages table, a per-page drawer (GEO signals, headers, schema, hreflang…), auto-saved report history, and one-click shareable HTML export.

> First run, generate the icon set: `cd src-tauri/icons && python3 generate.py && cd .. && pnpm tauri icon icons/source.png`

---

## What it checks

*46 rules and counting.*

**Technical SEO** — broken links · 4xx/5xx · redirects & chains · titles & meta descriptions (missing / duplicate / length) · H1s · canonicals · noindex / nofollow / X-Robots-Tag · robots.txt blocking · images missing alt · thin & duplicate content · orphan & deep pages

**Performance & security** — slow responses · large pages · missing compression · HTTPS · mixed content · HSTS

**Mobile, international & social** — viewport · `lang` · hreflang · Open Graph · Twitter cards · structured data

**GEO — Generative Engine Optimization** — structured data, semantic HTML, answer-readiness, authorship/E-E-A-T, dated content, question-style headings, and extractable blocks, rolled into a per-page **GEO score**.

Every finding links to plain-English guidance: **why it matters**, **how to fix it**, and **what happens if you ignore it**.

---

## How it compares

| | **crawlie** | Screaming Frog | Sitebulb |
|---|:---:|:---:|:---:|
| Price | **Free & open-source** | £259/yr to unlock | from £13.50/mo |
| Engine | **Rust, async, tiny binary** | Java (JVM) | .NET |
| CLI with JSON output | ✅ | partial | ❌ |
| **MCP server (agent-native)** | ✅ | ❌ | ❌ |
| **GEO — AI/answer-engine audit** | ✅ | ❌ | ❌ |
| **"Why it matters" built in** | ✅ every issue | ❌ | partial |
| Shareable HTML report | ✅ | paid | ✅ |
| Source you can read & extend | ✅ | ❌ | ❌ |

---

## Architecture

```
crates/
  crawlie-core    # the engine — crawl, audit, score, knowledge base, reports
  crawlie-cli     # `crawlie` — JSON / pretty / CSV / HTML output
  crawlie-mcp     # `crawlie-mcp` — Model Context Protocol server (stdio)
apps/
  desktop         # Tauri v2 + React (Geist) desktop app
```

`crawlie-core` has zero host dependencies — the same audited engine drops straight into a cloud worker (it already targets `wasm32`). One engine, every surface, identical results.

---

## Roadmap

- Cloud workers (shared Rust core) for scheduled/remote crawls
- JavaScript rendering for SPA-heavy sites
- Crawl-to-crawl comparison & regression alerts
- Internal-link graph visualization

---

## License & author

MIT © **Sean Ryan** / [Spronta](https://spronta.com).

Built by Sean Ryan — Lead Marketing Engineer at Pendo.io, building AI for marketers at Spronta on the side. **[Connect on LinkedIn →](https://linkedin.com/in/sean-exe)**

If crawlie saves you time, a ⭐ on the repo and a hello on LinkedIn mean a lot.
