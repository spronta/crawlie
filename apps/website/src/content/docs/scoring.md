---
title: Scoring
description: How crawlie calculates its two scores — a Health score for classic technical SEO and a GEO score for how citable your pages are by AI search.
section: Reference
order: 6
---

Every crawl returns two scores, each out of 100.

## Health score

Classic **technical SEO** health: broken links and status codes, redirects, titles and
meta descriptions, canonicals, robots directives, performance, security, and mobile /
international signals. This is the number that maps to "will search engines crawl, index,
and rank this cleanly?"

## GEO score

**Generative Engine Optimization** — how ready your pages are to be understood and
**cited by AI search** (ChatGPT, Perplexity, Google AI Overviews). It rewards:

- **Structured data** the engines can parse (Article, FAQ, Product, etc.).
- **Semantic HTML** that chunks cleanly into answers.
- **Answer-readiness** — question-style headings and extractable blocks.
- **Authorship / E-E-A-T** signals (bylines, dates, trust markers).
- **Substance** — enough real content to be worth citing.

A page that's great for classic SEO can still score low on GEO, which is exactly why
crawlie reports them separately.

## Severity levels

Findings are graded **error → warning → notice**. Use `--severity` to filter output and
`--fail-on` to gate CI on a threshold. See the [CLI reference](/docs/cli).

## Per-page scores

Beyond the site-wide rollup, crawlie computes per-page Health and GEO scores so you can
see exactly which URLs drag the average down — surfaced in the desktop app's pages table
and available in the JSON output.

## How the scores are weighted

Each score starts at 100 and is reduced by the findings on the page, weighted by
severity. An **error** costs more than a **warning**, which costs more than a **notice**.
The site-wide score is the weighted aggregate across all crawled pages, so a single broken
page won't tank an otherwise healthy site — but a systemic issue (a missing title template
on every page, say) will show up clearly in both the rollup and the per-page breakdown.

## What's a good score?

As a rule of thumb:

- **90–100** — healthy. Ship it; clean up the notices when convenient.
- **70–89** — solid, with real wins available. Work the prioritized Top Fixes.
- **below 70** — something systemic is wrong (missing metadata site-wide, many broken
  links, or thin/duplicate content). Fix the highest-impact rules first.

GEO scores tend to run lower than Health scores on most sites today, because structured
data, `llms.txt`, and answer-ready content are still uncommon — which is exactly the gap
crawlie is built to surface.

## Why are Health and GEO separate?

Because a page can be flawless for classic search and still be invisible to AI answer
engines. A fast, well-linked page with perfect metadata can lack structured data, an
author byline, or answer-ready sections — so it scores high on Health and low on GEO.
Splitting the two tells you *which* kind of work moves the needle, instead of averaging
two unrelated problems into one misleading number.
