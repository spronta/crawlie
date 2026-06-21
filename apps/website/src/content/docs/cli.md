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
| `--include <glob>` | Only crawl URLs matching this glob (repeatable). |
| `--exclude <glob>` | Skip URLs matching this glob (repeatable). |
| `--format <fmt>` | `json` (default), `pretty`, `csv`, or `html`. |
| `--severity <sev>` | Only show findings at/above a severity. |
| `-o, --output <file>` | Write to a file instead of stdout. |
| `--save` | Save to local report history. |
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

## CI gating

`--fail-on` turns crawlie into a quality gate. A non-zero exit fails the job.

```bash
crawlie crawl https://staging.example.com --fail-on error --quiet
```

See [CI & automation](/docs/ci) for a ready-to-paste workflow.
