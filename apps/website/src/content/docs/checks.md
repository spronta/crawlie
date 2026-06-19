---
title: What it checks
description: The full catalogue of crawlie's 46 technical-SEO and GEO rules — broken links, metadata, canonicals, structured data, AI-search readiness, and more.
section: Reference
order: 5
---

crawlie runs **46 rules and counting**. Every finding links to plain-English guidance —
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
`duplicate-content`, `low-text-ratio`, `deep-page`.

## Performance & security

Slow responses · large pages · missing compression · HTTPS · mixed content · HSTS.

Rule ids: `slow-response`, `large-page`, `no-compression`, `not-secure`,
`mixed-content`, `no-hsts`.

## Mobile, international & social

Viewport · `lang` · hreflang · Open Graph · Twitter cards · structured data.

Rule ids: `viewport-missing`, `lang-missing`, `hreflang-incomplete`, `og-missing`,
`twitter-missing`, `structured-data-missing`.

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
