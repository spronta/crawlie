# Changelog

All notable changes to crawlie are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.2] - 2026-06-28

Internal link graphs, and crawlie stops tripping over the www redirect.

### Added
- **Internal link graph.** Every crawl now maps how your pages link to each other: orphan pages (nothing links in), dead ends (nothing links out), reciprocal links, click depth, and your biggest hubs and highest-authority pages by internal PageRank. It shows in the CLI summary and the JSON (`linkGraph`), agents can query it with the new `link_graph` MCP tool, and the desktop app has a new **Link graph** tab you can drag, zoom, and click into.
- **`dead-end` check.** Flags indexable pages with no internal outlinks: visitors and crawlers arrive and can't go anywhere, and the page passes none of its authority on.
- **`--no-resolve-host` flag** (and `resolveHost` in config / the MCP) to skip canonical-host resolution and audit the literal start host.

### Changed
- **Crawls resolve to the canonical host by default.** If your start URL redirects to another host (apex to www, or http to https), crawlie re-bases the audit on the destination and tells you it did, instead of auditing a host that only redirects. The same thing Screaming Frog and Sitebulb do.
- **Desktop: a page opens as a full view with a breadcrumb**, not a side drawer. Saved Reports gained a sticky header, per-site favicons, and a fixed compare layout.

### Fixed
- **robots.txt, sitemap.xml and llms.txt behind a redirect are detected now.** Sites that 301/308 these files from the apex to www (or http to https) were wrongly reported as missing. crawlie now follows the redirect, the way search engines do. Thanks to [@fakebizprez](https://github.com/fakebizprez) for reporting it ([#3](https://github.com/spronta/crawlie/issues/3)).

## [0.5.1] - 2026-06-26

The desktop app got a glow-up, and crawlie finally learned some manners about what not to crawl.

### Added
- **JavaScript rendering, now in the desktop app.** The `--render` superpower from 0.5.0 is a one-click toggle in the crawl settings, so you can audit React, Vue and Next sites without ever opening a terminal. (The CLI and MCP have had it all along.)
- **Exclude hosts and paths, by plain text or regex.** Tell crawlie what to skip (analytics domains, share links, endless faceted URLs) from the new Advanced settings, the CLI (`--exclude-host`, `--exclude-path`, plus their `-regex` cousins), or the `crawl_site` MCP tool. A bad regex fails fast instead of silently matching nothing.
- **Global crawl defaults.** Set your user agent, crawl budget, render mode and friends once in Settings, and every new crawl starts from there. Override per crawl whenever the mood strikes.
- **Custom user agent**, surfaced in the desktop Advanced settings (the CLI and MCP already had it).

### Changed
- **The desktop app looks like it is from this decade.** A flat, Linear-style interface: a rounded content panel, a full-width sticky report header, a Pages table that finally uses the whole window, dark mode that moved into Settings and actually remembers your choice, and a Docs link in the sidebar.
- **The Overview dashboard means something at a glance.** Issues by category is a stacked severity bar, and Status codes and Crawl depth are colour-coded proportion strips instead of a row of identical grey bars.
- **Default user agent is now `crawlie (+https://crawlie.dev)`** (unversioned, and pointed at the right place).

### Fixed
- **Sidebar links open now.** Docs, GitHub and the update Download links open in your default browser instead of quietly doing nothing inside the app.

## [0.5.0] - 2026-06-26

JavaScript rendering — crawlie now sees what your users (and Google's renderer) see.

### Added
- **JavaScript rendering** — crawl with `--render` and crawlie drives a real headless browser, lets each page hydrate, and audits the **post-JavaScript DOM**. Content, links and meta tags injected by React, Next.js, Vue and other client-rendered frameworks are now seen instead of missed, so every one of crawlie's rules works on modern JS apps. Add `--render-wait <ms>` to wait for late-hydrating content. Uses your installed Chrome / Chromium / Edge (set `$CHROME` to pin one). Agents get it too via `render: true` on the `crawl_site` MCP tool. See the [docs](https://crawlie.dev/docs/cli#render-javascript-sites).
- **`content-requires-js` rule** — crawlie compares the raw server HTML against the rendered DOM and flags pages whose content only exists after JavaScript runs. That's a real risk: Google renders JS on a delayed, budget-limited second pass, and most AI answer engines don't run it at all — so a client-only page can be near-invisible to the very engines you want to rank and be cited in.

### Changed
- **More accurate content metrics** — body word count, thin-content detection and the text-to-HTML ratio now exclude the contents of `<script>`, `<style>`, `<noscript>` and `<template>`, so inline JavaScript and JSON data no longer inflate a page's apparent word count.

## [0.4.2] - 2026-06-24

Custom extraction lands, plus a brand refresh.

### Added
- **Custom extraction** — pull any data off every crawled page with CSS selectors or regular expressions: prices, authors, SKUs, publish dates, any attribute. `crawlie crawl <url> --extract 'price=.product-price'` (append `@attr` to read an attribute) or `--extract-regex 'sku=SKU-(\d+)'`, repeatable. With extractors set, `--format csv` becomes a tidy table (one row per page, one column per extractor); `--format json` carries the values per page. Agents get it too via the `extract` array on the `crawl_site` MCP tool. The free, scriptable take on Screaming Frog's Custom Extraction — see the [docs](https://crawlie.dev/docs/custom-extraction).

### Changed
- **New brand** — crawlie has a fresh logo. The new mark and wordmark lockup appear across the desktop app and the website (light/dark aware), with a new app icon and a theme-aware favicon.

## [0.4.1] - 2026-06-24

Polishes 0.4.0: streamed crawls are now inspectable, and you can compare crawls right in the desktop app.

### Added
- **`crawlie store <db>`** — inspect a streamed crawl from the command line. `crawl --store` now writes a complete, self-contained database (pages, findings, and summary), and `crawlie store` renders it in any format (`pretty`, `json`, `csv`, `html`) with the same `--severity` / `--output` flags as `report`.
- **Compare crawls in the desktop app** — a new **Compare** mode in Saved Reports: pick two crawls and see health/GEO score deltas, pages added and removed, and the issues that were resolved or newly appeared — the same crawl-over-crawl diff available via `crawlie diff` and the MCP `diff_reports` tool.

### Changed
- `crawl --store` together with `--save` no longer writes an empty entry to report history — the streamed database is the artifact (inspect it with `crawlie store`).
- Docs: added pages for `crawlie diff`, streaming crawls / `crawlie store`, the `diff_reports` MCP tool, and structured-data validation.

## [0.4.0] - 2026-06-23

Crawl bigger, see what changed, and validate your structured data — this release closes three of the biggest gaps between crawlie and the heavyweight desktop crawlers.

### Added
- **Crawl any size of site, without running out of memory** — the new streaming engine (`crawlie crawl --store <path>`) spills every page to an on-disk SQLite database as it crawls, then runs the full audit by streaming pages back one at a time. The crawl file is the artifact: peak memory stays bounded by a compact index instead of the whole site, so large crawls no longer mean the whole site in RAM.
- **Crawl-over-crawl diffing** — `crawlie diff <old> <new>` shows exactly what changed between two crawls: health and GEO score deltas, pages added and removed, and issues that newly appeared or were resolved (grouped by rule). The same is available to agents via the MCP `diff_reports` tool, and to the desktop app. Verify a fix actually landed, or catch a regression before it ships.
- **Structured-data validation** — crawlie now parses your JSON-LD properly (including `@graph` and nested types like an `Offer` inside a `Product`) and checks each item against Google's rich-result requirements. New findings flag **invalid JSON-LD** that search engines silently skip, **missing required fields** that make a rich result ineligible, and **missing recommended fields** that leave it weaker than it could be — across Article, Product, Recipe, Event, FAQ, Breadcrumb, JobPosting, LocalBusiness, and more.

### Changed
- **Saved reports now live in SQLite** — crawl history is stored in a single queryable `crawlie.db` instead of loose JSON files. Existing reports are imported automatically the first time you run this version; nothing to do.

## [0.3.0] - 2026-06-21

The biggest release yet: crawlie gains a deterministic content-quality engine, self-updating apps, and its own changelog.

### Added
- **`.crawlie` rule packs** — a deterministic, editable, agent-writable way to catch AI **slop** and off-brand copy. Rules are literal phrases, regexes, and text statistics (sentence burstiness, em-dash density, filler ratio, lexical diversity, repeated phrasing) — *no model at runtime*, so results are reproducible on every run. The new `crawlie-rules` engine is pure Rust and compiles to WebAssembly, so the same pack runs on your laptop, in CI, and in the cloud.
- **`crawlie slop`** — score a whole site, a file, or stdin against a rule pack. You get an explainable **ledger** of exactly which rules fired and the evidence (`--format json` for agents), and you can gate your build with `--fail-on-score`.
- **Installable rule packs** — `crawlie init` scaffolds an editable pack in your repo; `crawlie pack add / list / new / which / remove` manage packs across three layers (repo `.crawlie/`, global `~/.crawlie/packs`, and built-in). Ships with a tunable `slop-default` pack you can copy and make your own.
- **CLI self-update** — `crawlie update` checks for a newer release and installs it in place (`--check` to only look, `-y` to skip the prompt). A quiet nudge appears when you're behind.
- **Desktop auto-update** — the app now prompts when a new version is available and updates **in-app** in one click (download → install → restart). A new **Settings** area lets you toggle *check on launch* and fully automatic updates.

### Changed
- **New app icon** — the desktop app now wears the crawl-graph brand mark, matching the site and favicon.
- **Changelog moved to its own page** — release notes now live at **[crawlie.dev/changelog](https://crawlie.dev/changelog)** with a dedicated, search-friendly page per release, plus an email subscribe option so you hear about new versions.

### Fixed
- **Accurate compression auditing** — crawlie now advertises `Accept-Encoding` and decodes gzip / Brotli / deflate itself, so the "no compression" check reflects what a server actually sends instead of being masked by the HTTP client's transparent decompression.
- Page body text is now exposed to content checks (previously only aggregate word counts were available).
## [0.2.1] - 2026-06-19

### Changed
- **Renamed the npm package to `crawlie`** (unscoped) — install with `npm i -g crawlie`.
  Platform binary packages stay scoped (`@spronta/crawlie-<platform>`), and the previous
  `@spronta/crawlie` package remains published as an alias.

## [0.2.0] - 2026-06-19

### Added
- **Agent Skills** — four standalone [Agent Skills](https://agentskills.io) in `skills/`
  (`seo-site-audit`, `fix-broken-links`, `pre-launch-seo-check`, `geo-ai-readiness`)
  that teach any agent to run real audits. Each is self-contained: it needs neither
  the repo nor a pre-installed crawlie, bootstrapping the binary on demand via
  `npx -y -p crawlie` and preferring the MCP tools when present.
- **Claude Code plugin** — `.claude-plugin/` manifest bundling the crawlie MCP server
  (auto-run via npx) plus the skills, installable in one step
  (`claude plugin marketplace add spronta/crawlie` → `claude plugin install crawlie@spronta`).
- **Per-page SEO scores** (Yoast-style) for every crawled page.
- **PageRank link scores**, a prioritized **Top Fixes** list, and **llms.txt** detection.
- Interactive drill-downs on the overview charts.
- New-release detection banner and a draggable results header in the desktop app.
- Crawl date/time shown in the results header.

### Changed
- **MCP**: compact, agent-first tool responses plus report-slicing tools
  (`list_reports` / `get_report`) for reading saved crawl history.
- Issue filter chips now use Lucide severity icons; header gained a theme-aware accent bar.

### Fixed
- Self-heal stale scores when loading saved reports.
- Load older saved reports correctly (serde defaults for newly added score fields).
- GEO score was being computed against empty default signals (always ~8); now scored
  against real signals.
- Window dragging on the desktop app (`core:window:allow-start-dragging`) and centered
  traffic-light controls.

## [0.1.1] - 2026-06-18

### Added
- Initial public release: the crawlie engine (`crawlie-core`), CLI (`crawlie`), and
  stdio MCP server (`crawlie-mcp`), shipped via npm as `crawlie`, plus a
  signed/notarized macOS desktop app.
- ~40 technical-SEO and GEO (AI-search) checks, Health + GEO scoring, and plain-English
  fix guidance for every rule.

[0.3.0]: https://github.com/spronta/crawlie/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/spronta/crawlie/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/spronta/crawlie/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/spronta/crawlie/releases/tag/v0.1.1
