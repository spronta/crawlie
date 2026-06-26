---
title: CLI reference
description: Every crawlie CLI command, flag, and output format — crawl, audit, explain, and reports, with JSON/CSV/HTML output and exit codes for CI.
section: Guide
order: 2
---

The `crawlie` binary is agent-friendly: it defaults to clean JSON on stdout, supports
pretty/CSV/HTML output, and sets exit codes for CI gating.

## crawl

Crawl and audit a whole site from a seed URL.

```bash
crawlie crawl https://example.com --format pretty
```

| Flag | Description |
|---|---|
| `--max-pages <n>` | Max pages to crawl (default 500). |
| `--max-depth <n>` | Max link depth (default 16). |
| `-c, --concurrency <n>` | Concurrent requests (default 16). |
| `--timeout <secs>` | Per-request timeout (default 15). |
| `--no-external` | Skip HEAD-checking external/uncrawled links. |
| `--no-robots` | Ignore `robots.txt`. |
| `--no-sitemap` | Don't seed the crawl from `sitemap.xml`. |
| `--render` | Render each page with headless Chrome before auditing, so JavaScript-injected content, links and meta tags are seen (React/Next/Vue etc.). Surfaces `content-requires-js`. Requires a Chrome/Chromium/Edge install. |
| `--render-wait <ms>` | Extra settle delay after navigation for late-hydrating content (default 0). Only with `--render`. |
| `--include <glob>` | Only crawl URLs matching this glob (repeatable). |
| `--exclude <glob>` | Skip URLs matching this glob (repeatable). |
| `--format <fmt>` | `json` (default), `pretty`, `csv`, or `html`. |
| `--severity <sev>` | Only show findings at/above a severity. |
| `-o, --output <file>` | Write to a file instead of stdout. |
| `--save` | Save to local report history. |
| `--store <path>` | Stream pages to an on-disk SQLite database instead of holding them in memory — for very large sites. Inspect the result later with `crawlie store`. |
| `--extract <NAME=SELECTOR>` | Pull data off every page with a CSS selector (append `@attr` for an attribute). Repeatable. See [Custom extraction](/docs/custom-extraction). |
| `--extract-regex <NAME=PATTERN>` | Pull data off every page with a regex (capture group 1). Repeatable. |
| `--fail-on <sev>` | Exit non-zero on `error` or `warning` findings (for CI). |
| `-q, --quiet` | Suppress progress output. |

```bash
# Shareable, self-contained HTML report
crawlie crawl https://example.com --format html -o report.html

# Clean JSON for piping / scripting / agents
crawlie crawl https://example.com --format json -o report.json

# Only a section of the site
crawlie crawl https://example.com --include '/blog/**'
```

## audit

Audit one or more explicit URLs (no crawling).

```bash
crawlie audit https://example.com/pricing https://example.com/signup
```

Supports `--format`, `-o/--output`, and `-q/--quiet`.

## explain

Print plain-English guidance for any rule — **why it matters**, **how to fix it**, and
**what happens if you ignore it**.

```bash
crawlie explain geo-not-answerable
crawlie explain redirect-chain
```

See the full list in [What it checks](/docs/checks).

## slop, init & pack

Run a deterministic content [rule pack](/docs/rules) over a site or local text, and manage
installed packs.

```bash
crawlie slop https://example.com               # score with the resolved pack
crawlie slop --file draft.md                   # score local text
crawlie slop https://example.com --fail-on-score 8   # CI gate

crawlie init                                   # scaffold .crawlie/ in the repo
crawlie pack list                              # list packs and where they resolve from
crawlie pack new brand                         # scaffold a new pack to edit
```

See [Rule packs](/docs/rules) for the `.crawlie` language, metrics, and examples.

## reports

crawls saved with `--save` go to a local report store.

```bash
crawlie reports               # list saved reports
crawlie report <id>           # print a saved report
crawlie report <id> --delete  # remove it
```

## diff

Compare two saved reports — what improved, regressed, and changed between two crawls of
the same site. Shows health/GEO score deltas, pages added and removed, and issues that
newly appeared or were resolved (grouped by rule).

```bash
crawlie diff <old-id> <new-id>            # pretty summary
crawlie diff <old-id> <new-id> --format json
```

Great for verifying a fix actually landed, or catching a regression before it ships.
Agents get the same via the MCP `diff_reports` tool (see [MCP server](/docs/mcp)).

## store (large / streaming crawls)

For sites too large to hold in memory, `crawl --store <path>` streams every page to an
on-disk SQLite database as it crawls — peak memory stays bounded by a compact index
instead of the whole site. The database is the artifact; inspect it afterwards with
`crawlie store`.

```bash
crawlie crawl https://big-site.example --store crawl.db --quiet
crawlie store crawl.db                      # pretty report from the database
crawlie store crawl.db --format json        # full result incl. every page
crawlie store crawl.db --severity error     # only errors
```

`crawlie store` accepts the same `--format` and `-o/--output` flags as `report`.

## render (JavaScript sites)

By default crawlie audits the raw HTML a server returns. Modern client-rendered apps
(React, Next.js, Vue, Angular, client-rendered Shopify themes) inject their real
content, links and meta tags only after JavaScript runs — so the raw HTML is near
empty. `--render` drives a real headless browser, lets each page hydrate, and audits
the **post-JavaScript DOM** instead.

```bash
crawlie crawl https://app.example --render
crawlie crawl https://app.example --render --render-wait 500   # wait for late hydration
```

It needs a Chrome / Chromium / Edge install on the host (set `$CHROME` to pin a
specific binary). Rendering is slower than a raw fetch, so reach for it on JS-heavy
sites. crawlie also compares the raw HTML against the rendered DOM and raises
`content-requires-js` on pages whose content only exists after JavaScript — a real
risk, since Google renders JS on a delayed second pass and most AI answer engines
don't run it at all.

## CI gating

`--fail-on` turns crawlie into a quality gate. A non-zero exit fails the job.

```bash
crawlie crawl https://staging.example.com --fail-on error --quiet
```

See [CI & automation](/docs/ci) for a ready-to-paste workflow.
