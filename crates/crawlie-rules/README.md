# crawlie-rules

Deterministic, editable, agent-writable content rule packs for [crawlie](../../README.md) —
the engine behind `.crawlie` files.

Traditional crawlers ask *"is my site technically correct for Google?"* This
crate powers a different question: *"is my marketing site staying **true** —
human, on-brand, free of AI slop — over time?"* It detects slop, brand drift,
and tone problems in page text using nothing but literal phrases, regexes, and
deterministic statistics.

## Why deterministic (and not an LLM at runtime)

A black-box "slop score" from a model fails every property a content *monitor*
needs. So the intelligence lives at **authoring** time, not runtime:

> Use an LLM to **write** the rules from examples. Run the rules
> **deterministically** forever.

That single choice buys four things:

| Property        | Why it matters |
|-----------------|----------------|
| **Deterministic** | Same text + same pack ⇒ same result, every run. A monitor that flags a page one run and clears it the next is useless. |
| **Portable**    | Pure Rust — no async, no I/O, no clock, no randomness. The *same* crate compiles to a native binary (laptop / CI) **and** to `wasm32` (a Cloudflare Worker for Crawlie Cloud). |
| **Editable**    | Packs are plain text. Copy `slop-default.crawlie`, tune the weights and thresholds to your voice, commit it next to your site. |
| **Explainable** | Evaluation yields a **ledger** of exactly which rules fired and the evidence — never an opaque number. A writer can act on every point. |

## The `.crawlie` language

A pack is a sequence of rule-constructor calls. Three primitives, in increasing
power:

```python
# slop.crawlie

# 1. phrase rules — the AI-cliché dictionary
phrase_rule("ai-cliches", weight = 3, phrases = [
    "in today's fast-paced world", "unlock the power of", "it's important to note",
])

# 2. regex rules — structural tells (the LLM "rule of three")
regex_rule("rule-of-three", weight = 2, pattern = "\\w+, \\w+,? and \\w+")

# 3. metric rules — deterministic statistics compared to a threshold
metric_rule("low-burstiness", weight = 3,
    metric = sentence_variance(), when = below(12))
```

**Metrics** (all pure functions of the text): `sentence_variance()`,
`em_dash_density()`, `filler_ratio()`, `transition_ratio()`,
`lexical_diversity()`, `adverb_density()`, `ngram_repetition(n)`.

**Comparators**: `below(x)`, `above(x)`, `between(lo, hi)`.

Parse errors are structured (`{ line, col, message }`, JSON-serializable) so an
authoring agent can read the failure and patch the file without guessing.

## One artifact, three runtimes

The script only ever sees **(text, rules)**. Everything runtime-specific — how
text is acquired, where results go — lives outside the pack. So the identical
`.crawlie` file runs:

- **on a laptop** — `crawlie slop <url>`
- **in CI** — `crawlie slop <url> --fail-on-score 8` (non-zero exit gates the build)
- **in a Worker** — the `wasm32` build, on a cron trigger, alerting on regressions (Crawlie Cloud)

## Where packs live (resolution)

Packs resolve in layers, increasing in precedence, so the file you commit is the
file that runs in CI and (eventually) in Crawlie Cloud:

| Layer | Location | Installed via |
|-------|----------|---------------|
| **Built-in** | embedded in the binary (`slop-default`) | nothing — always available |
| **Global**   | `~/.crawlie/packs/<name>.crawlie` | `crawlie pack add <file> --global` |
| **Repo**     | `<repo>/.crawlie/<name>.crawlie` (committed) | `crawlie init`, `crawlie pack add <file>` |
| **Path**     | `--pack ./x.crawlie` | one-off, overrides all |

A repo pack shadows a global one of the same name, which shadows the built-in —
so `crawlie init` drops an editable `slop-default` into the repo that `crawlie
slop` then uses automatically.

```sh
crawlie init                        # scaffold .crawlie/slop-default.crawlie in the repo
crawlie pack new brand              # scaffold .crawlie/brand.crawlie to edit
crawlie pack add ./team.crawlie     # install into the repo (validated first)
crawlie pack add ./team.crawlie --global   # install for all your projects
crawlie pack list                   # show every pack + where it resolves from
crawlie pack which brand            # show which file a name resolves to
crawlie pack remove brand           # uninstall
```

## CLI

```sh
# score a whole site with the resolved slop pack (repo override or built-in)
crawlie slop https://example.com

# score with a pack by name (resolved) …
crawlie slop https://example.com --pack brand
# … or by path

# score with your own pack, as JSON for agents
crawlie slop https://example.com --pack ./brand.crawlie --format json

# score local text / piped content
crawlie slop --file draft.txt
echo "Unlock the power of synergy." | crawlie slop --stdin

# CI gate: fail if any page scores >= 8
crawlie slop https://example.com --fail-on-score 8
```

## Library

```rust
use crawlie_rules::{default_pack, load};

let pack = default_pack().unwrap();                 // or load("brand", src)
let ledger = pack.evaluate(page_text);
println!("slop {}", ledger.score);
for hit in ledger.hits {
    println!("  +{} {} — {:?}", hit.points, hit.rule, hit.evidence);
}
```

## Roadmap

This crate is the proving ground for "deterministic, editable rule packs" as
crawlie's core content abstraction. Next:

- **Brand-drift packs** — same primitives (banned terms, required product-name
  casing, claim-consistency regexes).
- **Corpus-level rules** — cross-page checks (contradictions, cannibalization)
  over the whole crawl held in memory.
- **Incremental evaluation** — score only pages whose content hash changed
  since the last crawl (the Crawlie Cloud cost model).
- **`crawlie gen "<intent>"`** + MCP `generate_suite` — an agent writes a pack
  from a brand brief; you review and commit it.
