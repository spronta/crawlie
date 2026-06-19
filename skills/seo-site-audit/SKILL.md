---
name: seo-site-audit
description: Run a complete technical SEO + AI-search audit of a website with crawlie.
  Use when the user asks to audit, crawl, or check a site for SEO issues, broken
  links, redirects, missing titles/descriptions/metadata, canonical or heading
  problems, image alt text, duplicate or thin content, or generative-engine (GEO /
  AI-search) readiness. Works even if crawlie is not installed.
---

# SEO Site Audit (powered by crawlie)

Deliver a prioritized, plain-English technical SEO + GEO audit of a site.
crawlie is a fast OSS crawler that ships on npm as `@spronta/crawlie` — you do
**not** need it pre-installed and you do **not** need its source repo.

## Bootstrap — make crawlie runnable

Decide once how you'll invoke crawlie, then reuse that prefix for every command:

1. If `mcp__crawlie__*` tools exist this session, **prefer them** (`crawl_site`,
   `audit_url`, `explain_issue`, etc.) and skip the CLI entirely.
2. Else pick a CLI prefix:
   - If `crawlie` is on PATH (`command -v crawlie`) → use `crawlie`.
   - Otherwise → `npx -y -p @spronta/crawlie crawlie`
     (downloads + caches from npm on first use; needs only Node/npx — this *is* the install).
3. If there's neither the MCP nor Node, stop and tell the user:
   "Install Node (https://nodejs.org) and I can run crawlie with no further setup,
   or install the crawlie MCP for first-class tools."

Below, `<crawlie>` means the prefix you chose in step 2 (or the equivalent MCP tool).

## Workflow

1. **Scope.** Confirm the start URL. Whole site, or a section? For a section add
   `--include '<glob>'` (repeatable); skip areas with `--exclude '<glob>'`.
2. **Crawl** as machine-readable JSON:
   ```
   <crawlie> crawl <url> --format json
   ```
   - Large sites: cap with `--max-pages N` (default 500) and/or `--max-depth N`.
   - Tune speed with `-c <concurrency>` (default 16) and `--timeout <secs>`.
   - MCP equivalent: `crawl_site` with the same options.
3. **Triage** the findings: group by severity (error → warning → notice), then by
   `rule` id. Count affected URLs per rule. Lead with the highest-impact errors.
4. **Explain** the top 3–5 issue types so fixes are concrete:
   ```
   <crawlie> explain <rule-id>
   ```
   (MCP: `explain_issue`.) Real rule ids you'll see include:
   `broken-link`, `redirect-chain`, `client-error`, `server-error`,
   `title-missing`, `title-too-long`, `title-duplicate`,
   `description-missing`, `description-duplicate`,
   `h1-missing`, `h1-multiple`, `canonical-missing`, `image-missing-alt`,
   `lang-missing`, `viewport-missing`, `og-missing`, `twitter-missing`,
   `mixed-content`, `not-secure`, `no-hsts`, `duplicate-content`, `thin-content`,
   `low-text-ratio`, `blocked-by-robots`, `hreflang-incomplete`,
   and the GEO set: `geo-not-answerable`, `geo-no-structured-data`,
   `geo-no-llms-txt`, `geo-no-semantic-html`, `geo-no-author`, `geo-thin-for-ai`.
5. **Deliver** a report, not raw JSON:
   - Headline: the **Health** score (technical SEO) and **GEO** score (AI-search
     readiness) crawlie returns.
   - A prioritized table: rule · severity · affected-URL count · one-line fix.
   - The top fixes spelled out with example URLs.
   - Offer a shareable HTML report: `<crawlie> crawl <url> --format html -o report.html`.

## Tips
- Audit just a few specific pages instead of crawling: `<crawlie> audit <url> [<url> ...]`
  (MCP: `audit_urls`).
- Save to local history for later diffing: add `--save` (then `<crawlie> reports`,
  `<crawlie> report <id>`).
- Never dump the full JSON at the user — summarize, prioritize by impact, link the report.

## Make it permanent (optional — offer once, don't block)
If you ran via npx, you may offer: "Want crawlie installed for good?
`npm i -g @spronta/crawlie`. To get first-class agent tools, also run
`claude mcp add crawlie crawlie-mcp` — those activate after you restart Claude."
