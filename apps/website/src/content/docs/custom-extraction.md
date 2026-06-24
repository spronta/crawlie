---
title: Custom extraction
description: Pull arbitrary data off every crawled page with CSS selectors or regular expressions — prices, authors, SKUs, tags, any attribute — and export it as a CSV table or JSON. crawlie's Screaming-Frog-style custom extraction, free and scriptable.
section: Guide
order: 5
---

Custom extraction pulls **any data you want off every page** in a crawl — prices,
author names, SKUs, publish dates, social handles, canonical targets, whatever —
using CSS selectors or regular expressions. It's the free, scriptable equivalent
of Screaming Frog's Custom Extraction.

## CSS selectors

Pass one or more `--extract 'NAME=SELECTOR'` flags. `NAME` becomes the output
column; `SELECTOR` is any CSS selector. By default the **text** of each matching
element is captured.

```bash
crawlie crawl https://shop.example \
  --extract 'price=.product-price' \
  --extract 'heading=h1' \
  --format csv
```

### Extract an attribute

Append `@attr` to read an attribute instead of the element's text:

```bash
crawlie crawl https://blog.example \
  --extract 'author=meta[name=author]@content' \
  --extract 'canonical=link[rel=canonical]@href' \
  --extract 'image=meta[property="og:image"]@content' \
  --format csv
```

## Regular expressions

`--extract-regex 'NAME=PATTERN'` runs the pattern over the raw HTML. If the
pattern has a capture group, group 1 is captured; otherwise the whole match.

```bash
crawlie crawl https://shop.example \
  --extract-regex 'sku=SKU-(\d+)' \
  --extract-regex 'gtin=gtin13"\s*:\s*"(\d+)"' \
  --format csv
```

Both flags are repeatable and can be combined in one crawl.

## Output

With any extractors set, `--format csv` becomes an **extraction table** — one row
per crawled page, a column per extractor:

```text
url,price,author
https://shop.example/widgets/a,$49.99,Jane Smith
https://shop.example/widgets/b,$19.00,Jane Smith
```

When an extractor matches **multiple** elements on a page, the values are joined
with ` | ` in the CSV. In `--format json`, each page carries an `extractions`
array with the full list of values per extractor — ideal for scripting and agents.

## Use it from an agent (MCP)

The [`crawl_site`](/docs/mcp) MCP tool accepts an `extract` array, so an agent can
pull structured data in one call:

```json
{
  "url": "https://shop.example",
  "includePages": true,
  "extract": [
    { "name": "price", "css": ".product-price" },
    { "name": "author", "css": "meta[name=author]", "attr": "content" },
    { "name": "sku", "regex": "SKU-(\\d+)" }
  ]
}
```

## Notes

- **CSS and regex are supported today; XPath isn't yet.** CSS selectors cover the
  vast majority of extraction needs.
- Extraction runs on successful (200) HTML pages.
- An invalid selector or pattern fails the crawl immediately with a clear error,
  so a typo never silently extracts nothing.
- Up to 50 values are captured per extractor per page.
