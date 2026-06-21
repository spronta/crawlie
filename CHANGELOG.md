# Changelog

All notable changes to crawlie are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
