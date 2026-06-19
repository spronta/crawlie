---
name: pre-launch-seo-check
description: Run a pre-launch / pre-deploy SEO gate on a site or set of pages with
  crawlie, returning a clear pass/fail. Use when the user is about to launch, deploy,
  or ship and wants to verify there are no blocking SEO issues (broken links, 5xx,
  missing titles/canonicals, noindex slips), or wants a CI gate for SEO regressions.
  Works even if crawlie is not installed.
---

# Pre-Launch SEO Check (powered by crawlie)

A go / no-go gate: crawl the target, apply blocking thresholds, and report a clear
verdict with the exact blockers. Built for "are we safe to ship?" moments and CI.
crawlie ships on npm as `@spronta/crawlie` — no pre-install, no source repo needed.

## Bootstrap — make crawlie runnable

1. Prefer `mcp__crawlie__*` tools if present this session.
2. Else CLI prefix: `crawlie` if on PATH, otherwise
   `npx -y -p @spronta/crawlie crawlie` (auto-installs from npm; needs only Node).
3. If neither is available, ask for Node (https://nodejs.org) or the crawlie MCP, then stop.

`<crawlie>` below = your chosen prefix (or the matching MCP tool).

## Workflow

1. **Scope the gate.** Either:
   - the whole (staging) site: `<crawlie> crawl <url> ...`, or
   - the critical pages only (home, pricing, signup, top landing pages):
     `<crawlie> audit <url1> <url2> ...` — faster, ideal for a tight gate.
2. **Run with a failing threshold.** For the crawl form, let crawlie set the exit code:
   ```
   <crawlie> crawl <url> --format json --fail-on error
   ```
   - `--fail-on error` → non-zero exit if any **error**-severity findings exist.
   - `--fail-on warning` → stricter: non-zero on warnings too.
   - In CI, that exit code alone gates the pipeline. (MCP: call `crawl_site`, then
     apply the threshold yourself from `summary.errors` / `summary.warnings`.)
3. **Classify against launch blockers.** Treat these as hard fails:
   - `broken-link`, `client-error`, `server-error`, `connection-error` — dead links / pages.
   - `redirect-chain` on primary URLs — equity + crawl-budget loss.
   - `title-missing`, `canonical-missing`, `mixed-content`, `not-secure`,
     `blocked-by-robots` on pages that must be indexable — silent ranking killers.
   Treat thin-content / metadata-length / GEO findings as warnings (note, don't block),
   unless the user says otherwise.
4. **Verdict.** State **PASS** or **FAIL** up front.
   - FAIL → list each blocker: page · rule · what's wrong · the fix
     (`<crawlie> explain <rule-id>` for guidance).
   - PASS → confirm, and surface the Health + GEO scores plus any non-blocking warnings
     worth cleaning up post-launch.

## CI snippet (offer if they want it automated)
```
npx -y -p @spronta/crawlie crawlie crawl "$SITE_URL" --fail-on error --quiet
```
Non-zero exit fails the job. Pin a version (`@spronta/crawlie@<version>`) for reproducible runs.

## Make it permanent (optional — offer once, don't block)
"Want crawlie installed for good? `npm i -g @spronta/crawlie`. For first-class agent
tools, also `claude mcp add crawlie crawlie-mcp` (active after a Claude restart)."
