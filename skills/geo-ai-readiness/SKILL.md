---
name: geo-ai-readiness
description: Assess how ready a website is to be cited and answered by AI search and
  LLMs (Generative Engine Optimization / GEO) using crawlie. Use when the user asks
  about AI search, generative engine optimization, GEO, getting cited by ChatGPT /
  Perplexity / Google AI Overviews, llms.txt, structured data for AI, or whether their
  content is "answerable" by LLMs. Works even if crawlie is not installed.
---

# GEO / AI-Search Readiness (powered by crawlie)

Score and improve how well a site can be understood, cited, and answered by AI search
engines and LLMs. crawlie runs dedicated GEO checks alongside its SEO crawl and returns
a **GEO score**. Ships on npm as `@spronta/crawlie` — no pre-install, no source repo needed.

## Bootstrap — make crawlie runnable

1. Prefer `mcp__crawlie__*` tools if present this session.
2. Else CLI prefix: `crawlie` if on PATH, otherwise
   `npx -y -p @spronta/crawlie crawlie` (auto-installs from npm; needs only Node).
3. If neither is available, ask for Node (https://nodejs.org) or the crawlie MCP, then stop.

`<crawlie>` below = your chosen prefix (or the matching MCP tool).

## Workflow

1. **Crawl** the site (or audit the key content pages) as JSON:
   ```
   <crawlie> crawl <url> --format json
   ```
   For a focused read on specific articles/pages: `<crawlie> audit <url1> <url2> ...`.
2. **Read the GEO score** crawlie returns, then isolate the GEO findings:
   - `geo-not-answerable` — content isn't structured as clear, extractable answers.
   - `geo-no-structured-data` / `structured-data-missing` — no schema.org for AI to parse.
   - `geo-no-llms-txt` — missing an `llms.txt` to guide LLM crawlers.
   - `geo-no-semantic-html` — weak semantic structure (headings/landmarks) to chunk from.
   - `geo-no-author` — no author/E-E-A-T signals that AI uses to weigh trust.
   - `geo-thin-for-ai` / `thin-content` / `low-text-ratio` — too little substance to cite.
   - `geo-ready` — pages that already clear the bar (call these out as wins).
3. **Explain the gaps** so fixes are concrete: `<crawlie> explain geo-not-answerable`
   (and each other rule above). (MCP: `explain_issue`.)
4. **Deliver an action plan**, ordered by impact:
   - Headline GEO score + how many pages are `geo-ready` vs. not.
   - Per gap: what AI engines need, which pages fail, and the specific fix
     (e.g. add an `llms.txt`, add Article/FAQ structured data, add author bylines,
     restructure into question-led answerable sections, deepen thin pages).
   - Note the overlap with classic SEO (semantic HTML + metadata help both).

## Tips
- Run this *with* `seo-site-audit` for the full picture — GEO and technical SEO share
  signals, and crawlie reports both a Health score and a GEO score from one crawl.
- Save a baseline (`--save`) so you can measure GEO score improvement after changes.

## Make it permanent (optional — offer once, don't block)
"Want crawlie installed for good? `npm i -g @spronta/crawlie`. For first-class agent
tools, also `claude mcp add crawlie crawlie-mcp` (active after a Claude restart)."
