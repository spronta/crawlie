---
title: What it checks
description: The full catalogue of crawlie's 57 technical-SEO, accessibility and GEO rules — broken links, metadata, canonicals, structured-data validation, WCAG accessibility checks, JavaScript-rendering checks, AI-search readiness, and more.
section: Reference
order: 5
---

crawlie runs **57 rules and counting**. Every finding links to plain-English guidance —
why it matters, how to fix it, and what happens if you ignore it. Get that for any rule
with `crawlie explain <rule-id>` (or the `explain_issue` MCP tool).

## Technical SEO

Broken links · 4xx / 5xx · redirects & chains · titles & meta descriptions
(missing / duplicate / length) · H1s · canonicals · noindex / nofollow / X-Robots-Tag ·
robots.txt blocking · images missing alt · thin & duplicate content · orphan & deep pages.

Representative rule ids: `broken-link`, `client-error`, `server-error`,
`redirect-chain`, `title-missing`, `title-too-long`, `title-duplicate`,
`description-missing`, `description-duplicate`, `h1-missing`, `h1-multiple`,
`canonical-missing`, `image-missing-alt`, `blocked-by-robots`, `thin-content`,
`duplicate-content`, `low-text-ratio`, `content-requires-js`, `deep-page`.

## Performance & security

Slow responses · large pages · missing compression · HTTPS · mixed content · HSTS.

Rule ids: `slow-response`, `large-page`, `no-compression`, `not-secure`,
`mixed-content`, `no-hsts`.

## Accessibility (WCAG)

Static, false-positive-resistant accessibility checks — decided from the markup alone, no
rendering or contrast analysis required. crawlie flags links and buttons with no accessible
name (icon-only controls, empty `aria-label`s), form fields with no associated label
(a placeholder isn't a label), iframes missing a `title`, viewports that block pinch-zoom
(`user-scalable=no` / low `maximum-scale`), positive `tabindex` values that hijack focus
order, and headings that skip a level. These run on every HTML page, indexable or not.

Rule ids: `a11y-link-no-text`, `a11y-button-no-text`, `a11y-input-no-label`,
`a11y-zoom-disabled`, `a11y-iframe-no-title`, `a11y-positive-tabindex`,
`a11y-skipped-heading`.

## Mobile, international & social

Viewport · `lang` · hreflang · Open Graph · Twitter cards · structured data.

Rule ids: `viewport-missing`, `lang-missing`, `hreflang-incomplete`, `og-missing`,
`twitter-missing`, `structured-data-missing`.

## Structured-data validation

Beyond detecting JSON-LD, crawlie parses it and validates each item against Google's
rich-result requirements — flagging markup that won't earn a rich result. It catches
JSON-LD that doesn't parse at all, required properties that are missing (e.g. `price` on
an `Offer`, `image` on a `Product`), and recommended properties worth adding — across
Article, Product, Recipe, Event, FAQ, Breadcrumb, JobPosting, LocalBusiness, and more.

Rule ids: `structured-data-invalid`, `schema-missing-required`,
`schema-missing-recommended`.

## JavaScript rendering

Run a crawl with `--render` (CLI) or `render: true` (MCP) and crawlie audits each
page from its **post-JavaScript DOM** via headless Chrome — so content, links and
meta tags injected by React, Next.js, Vue and other client-rendered frameworks are
seen, not missed. crawlie compares the raw server HTML with the rendered DOM and
flags pages whose content only exists after JavaScript runs — a real risk, since
Google renders JS on a delayed second pass and most AI answer engines don't run it
at all.

Rule id: `content-requires-js`.

## GEO — Generative Engine Optimization

How citable your pages are by AI search like ChatGPT, Perplexity, and Google AI
Overviews: structured data, semantic HTML, answer-readiness, authorship / E-E-A-T, dated
content, question-style headings, and extractable blocks — rolled into a per-page **GEO
score**.

Rule ids: `geo-not-answerable`, `geo-no-structured-data`, `geo-no-semantic-html`,
`geo-no-llms-txt`, `geo-no-author`, `geo-thin-for-ai`, `geo-ready`.

> Want the live, authoritative list? Run `crawlie explain` with no rule to print the full
> catalogue (CLI), or call the `list_rules` MCP tool — it reflects exactly what your
> installed version checks.
