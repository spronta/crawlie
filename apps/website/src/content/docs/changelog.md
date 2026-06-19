---
title: Changelog
description: Every notable change to crawlie — new checks, MCP improvements, and fixes, newest first.
section: Project
order: 9
---

## [0.2.0] - 2026-06-19

### Added
- **Agent Skills** — four standalone [Agent Skills](https://agentskills.io) in `skills/`
  (`seo-site-audit`, `fix-broken-links`, `pre-launch-seo-check`, `geo-ai-readiness`)
  that teach any agent to run real audits. Each is self-contained: it needs neither
  the repo nor a pre-installed crawlie, bootstrapping the binary on demand via
  `npx -y -p @spronta/crawlie` and preferring the MCP tools when present.
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
  stdio MCP server (`crawlie-mcp`), shipped via npm as `@spronta/crawlie`, plus a
  signed/notarized macOS desktop app.
- ~40 technical-SEO and GEO (AI-search) checks, Health + GEO scoring, and plain-English
  fix guidance for every rule.

[0.2.0]: https://github.com/spronta/crawlie/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/spronta/crawlie/releases/tag/v0.1.1
