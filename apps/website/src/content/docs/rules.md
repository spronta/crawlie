---
title: Rule packs
description: Write deterministic, editable rule packs in crawlie's .crawlie language to catch AI slop, brand drift, and tone problems. Syntax, metrics, examples, and CI gating.
section: Guide
order: 3
---

The 46 built-in [checks](/docs/checks) answer *"is my site technically correct for Google?"*.
Rule packs answer a different question: *"is my site staying **true** over time — human,
on-brand, and free of AI slop?"*

A rule pack is a `.crawlie` file: a short, plain-text script of content rules. crawlie runs
it deterministically over each page's text and returns a **slop score** plus a ledger of
exactly which rules fired and why. There is no model at runtime, so the same text and the
same pack always produce the same result, on your laptop, in CI, or in a Worker.

> The intelligence lives at authoring time, not runtime. Use an LLM (or your own judgement)
> to **write** the rules once, then run them **deterministically** forever.

## Quick start

Score a live site with the built-in `slop-default` pack:

```bash
crawlie slop https://example.com
```

```text
  3 pages scored · avg 4.7 · worst 9.0

    9.0  https://example.com/blog/unlock-synergy
         ai-cliches, empty-buzzwords, rule-of-three, low-burstiness
    4.0  https://example.com/about
         filler-heavy, transition-heavy
    1.0  https://example.com/pricing
```

A clean marketing page scores ~0–2; slop piles up fast past ~6.

You can also score local text or piped input, without crawling:

```bash
crawlie slop --file draft.md
echo "Unlock the power of synergy to take your brand to the next level." | crawlie slop --stdin
```

## The `.crawlie` language

A pack is a sequence of rule-constructor calls. There are three primitives, in increasing
power. Each rule has a name, a `weight` (the points it adds when it fires), and its matcher.

```python
# brand.crawlie

# 1. phrase rules — a literal dictionary of banned phrases (case-insensitive)
phrase_rule("ai-cliches", weight = 3, phrases = [
    "in today's fast-paced world",
    "unlock the power of",
    "it's important to note",
])

# 2. regex rules — structural tells (here, the LLM "rule of three")
regex_rule("rule-of-three", weight = 2, pattern = "\\w+, \\w+,? and \\w+")

# 3. metric rules — a deterministic statistic compared to a threshold
metric_rule("low-burstiness", weight = 3,
    metric = sentence_variance(), when = below(12))
```

### Metrics

Metrics are pure functions of the page text. Use them in a `metric_rule` with a comparator:

| Metric | What it measures |
|---|---|
| `sentence_variance()` | Spread of sentence lengths. Low = robotic, uniform prose. |
| `em_dash_density()` | Em dashes per word. A notorious LLM fingerprint. |
| `filler_ratio()` | Share of low-information filler words. |
| `transition_ratio()` | Front-loaded connectives ("Moreover,", "Furthermore,"). |
| `lexical_diversity()` | Unique words / total words. Low = repetitive, padded. |
| `adverb_density()` | Share of `-ly` adverbs. |
| `ngram_repetition(n)` | Repeated n-word phrases. High = templated or spun copy. |

### Comparators

Pair a metric with one of:

| Comparator | Fires when the metric is |
|---|---|
| `below(x)` | less than `x` |
| `above(x)` | greater than `x` |
| `between(lo, hi)` | within the range `lo`–`hi` |

### Errors are structured

If a pack has a syntax error, crawlie reports it as `{ line, col, message }` (JSON when
`--format json`), so a human or an authoring agent can read the failure and fix the exact
spot instead of guessing.

## The ledger

Evaluating a pack never returns an opaque number. It returns a **ledger**: the total score
plus every rule that fired and the evidence behind it. Score a single file to see it:

```bash
crawlie slop --file draft.md
```

```text
(input)  ·  slop score 7.0

  +3.0 ai-cliches
        "unlock the power of"
        "it's important to note"
  +2.0 rule-of-three
        "fast, reliable, and scalable"
  +2.0 filler-heavy
        filler_ratio = 0.052 (threshold > 0.04)
```

Every point is attributable to a rule and a piece of evidence a writer can act on.

## Running it

```bash
# score a whole site with the resolved pack
crawlie slop https://example.com

# score with a pack by name (resolved) or by path
crawlie slop https://example.com --pack brand
crawlie slop https://example.com --pack ./brand.crawlie

# JSON for agents and pipelines
crawlie slop https://example.com --pack brand --format json

# score local text / piped content
crawlie slop --file draft.md
cat draft.md | crawlie slop --stdin
```

| Flag | Description |
|---|---|
| `--pack <name\|path>` | Pack to run. Defaults to the resolved `slop-default`. |
| `--file <path>` | Score a local text file instead of crawling. |
| `--stdin` | Score text read from stdin. |
| `--max-pages <n>` | Max pages to crawl in URL mode (default 100). |
| `--format <fmt>` | `pretty` (default) or `json`. |
| `--fail-on-score <n>` | Exit non-zero if any page scores at/above `n` (CI gate). |
| `-q, --quiet` | Suppress progress output. |

### CI gating

`--fail-on-score` turns a pack into a build gate. The command exits non-zero if any page
meets or exceeds the threshold, so a regression fails the pipeline:

```bash
# fail the build if any page scores 8 or higher
crawlie slop https://staging.example.com --fail-on-score 8
```

See [CI & automation](/docs/ci) for a full GitHub Actions workflow.

## Where packs live

Packs resolve in layers, increasing in precedence, so the file you commit is the file that
runs in CI:

| Layer | Location | Installed via |
|---|---|---|
| **Built-in** | embedded in the binary (`slop-default`) | nothing, always available |
| **Global** | `~/.crawlie/packs/<name>.crawlie` | `crawlie pack add <file> --global` |
| **Repo** | `<repo>/.crawlie/<name>.crawlie` (committed) | `crawlie init`, `crawlie pack add <file>` |
| **Path** | `--pack ./x.crawlie` | one-off, overrides everything |

A repo pack shadows a global one of the same name, which shadows the built-in. So
`crawlie init` drops an editable copy of `slop-default` into your repo, and `crawlie slop`
picks it up automatically.

### Managing packs

```bash
crawlie init                     # scaffold .crawlie/slop-default.crawlie in the repo
crawlie pack new brand           # scaffold .crawlie/brand.crawlie to edit
crawlie pack add ./team.crawlie  # install into the repo (validated first)
crawlie pack add ./team.crawlie --global   # install for all your projects
crawlie pack list                # list every pack and where it resolves from
crawlie pack which brand         # show which file a name resolves to
crawlie pack remove brand        # uninstall (repo by default, or --global)
```

## Example: a brand-voice pack

The same three primitives cover brand drift and tone, not just AI slop. Copy
`.crawlie/slop-default.crawlie` (after `crawlie init`) and add rules for your own voice:

```python
# .crawlie/brand.crawlie

# Words we never want in our copy.
phrase_rule("off-brand-terms", weight = 4, phrases = [
    "cheap", "guru", "ninja", "rockstar", "world-class",
])

# Always "crawlie", never "Crawlie" or "CrawlIE".
regex_rule("product-name-casing", weight = 3, pattern = "\\bCrawl(ie|IE)\\b")

# Keep it punchy: flag pages whose sentences run long and uniform.
metric_rule("too-corporate", weight = 2,
    metric = sentence_variance(), when = below(20))

# Don't pad with adverbs.
metric_rule("adverb-heavy", weight = 2,
    metric = adverb_density(), when = above(0.05))
```

Run it the same way as any pack:

```bash
crawlie slop https://example.com --pack brand --fail-on-score 6
```

## Library

The engine is a small, dependency-light Rust crate (`crawlie-rules`). It is pure (no I/O,
no clock, no randomness) and compiles to both native and `wasm32`, so the identical pack
runs in a CLI and in a Cloudflare Worker:

```rust
use crawlie_rules::{default_pack, load};

let pack = default_pack().unwrap();      // or: load("brand", src)?
let ledger = pack.evaluate(page_text);

println!("slop {}", ledger.score);
for hit in ledger.hits {
    println!("  +{} {} — {:?}", hit.points, hit.rule, hit.evidence);
}
```

## Next steps

- Run [`crawlie init`](/docs/cli) and tune `.crawlie/slop-default.crawlie` to your voice.
- Gate deploys on a pack with [CI & automation](/docs/ci).
- Combine it with the [46 technical checks](/docs/checks) for a full picture of site health.
