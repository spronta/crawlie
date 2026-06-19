---
name: fix-broken-links
description: Find and fix broken links, dead pages, and redirect chains on a website
  with crawlie. Use when the user asks to find broken links, 404s, dead links, link
  rot, redirect chains/loops, or 4xx/5xx pages, or to check that a site's links are
  healthy. Works even if crawlie is not installed.
---

# Find & Fix Broken Links (powered by crawlie)

Crawl a site, surface every broken link and redirect problem, group them by where
they live, and propose concrete fixes. crawlie ships on npm as `@spronta/crawlie` —
no pre-install and no source repo required.

## Bootstrap — make crawlie runnable

1. If `mcp__crawlie__*` tools exist this session, prefer them and skip the CLI.
2. Else choose a CLI prefix:
   - `crawlie` if it's on PATH (`command -v crawlie`), else
   - `npx -y -p @spronta/crawlie crawlie` (auto-downloads from npm; needs only Node).
3. If neither is available, ask the user to install Node (https://nodejs.org) or the
   crawlie MCP, then stop.

`<crawlie>` below = the prefix from step 2 (or the matching MCP tool).

## Workflow

1. **Crawl** for link health as JSON:
   ```
   <crawlie> crawl <url> --format json
   ```
   - Keep external link checking ON (it's the default) so off-site 404s are caught.
     Add `--no-external` only if the user explicitly wants internal-only.
   - Large sites: `--max-pages N`. (MCP equivalent: `crawl_site`.)
2. **Filter** the findings to the link/status rules:
   - `broken-link` — link target returns an error.
   - `client-error` (4xx), `server-error` (5xx) — pages/resources failing outright.
   - `redirect-chain` — multi-hop or looping redirects that waste crawl budget + link equity.
   - `connection-error` — host unreachable / DNS / TLS failures.
3. **Group by source page.** For each finding crawlie reports the page the bad link is
   *on* and the failing target. Cluster by source page so the user can fix several at once,
   and note repeated targets (a single dead URL linked from many pages = one fix, big impact).
4. **Explain + recommend.** Run `<crawlie> explain broken-link` (and `redirect-chain`)
   for the rationale, then for each cluster propose the fix:
   - 404 internal → correct the URL, restore the page, or remove the link.
   - 404 external → update to the live URL or drop the link.
   - redirect chain → point the link directly at the final destination.
   - 5xx → flag as a server issue to investigate, not just a link edit.
5. **Deliver** a table: source page · broken target · status/rule · suggested fix.
   Sort by number of occurrences so the highest-leverage fixes are first.

## Tips
- Re-check a handful of pages after fixes without a full re-crawl:
  `<crawlie> audit <url> [<url> ...]` (MCP: `audit_urls`).
- For a CI gate that blocks merges on broken links:
  `<crawlie> crawl <url> --fail-on error` (exits non-zero when errors exist).

## Make it permanent (optional — offer once, don't block)
"Want crawlie installed for good? `npm i -g @spronta/crawlie`. For first-class agent
tools, also `claude mcp add crawlie crawlie-mcp` (active after a Claude restart)."
