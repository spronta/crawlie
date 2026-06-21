//! Deterministic text metrics.
//!
//! Every function here is a pure function of its input: same text in, same
//! number out, on every platform. No clock, no randomness, no locale, no
//! network. That is what lets a `.crawlie` pack produce identical results on a
//! laptop, in CI, and inside a Cloudflare Worker — and what makes a content
//! monitor trustworthy (a check that flags a page one run and clears it the
//! next is useless).

/// Lowercased word token with surrounding ASCII punctuation stripped.
/// Internal helper so metrics agree on what "a word" is.
fn norm_word(raw: &str) -> &str {
    raw.trim_matches(|c: char| !c.is_alphanumeric())
}

/// Whitespace-split word tokens (non-empty after punctuation trim).
pub fn words(text: &str) -> Vec<&str> {
    text.split_whitespace()
        .map(norm_word)
        .filter(|w| !w.is_empty())
        .collect()
}

/// Total word count.
pub fn word_count(text: &str) -> usize {
    words(text).len()
}

/// Split into sentences on `.`, `!`, `?` (deterministic, dependency-free).
/// Good enough for length-distribution statistics, which is all we need.
pub fn sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in text.chars() {
        cur.push(ch);
        if matches!(ch, '.' | '!' | '?') {
            let trimmed = cur.trim();
            if !trimmed.is_empty() {
                out.push(trimmed.to_string());
            }
            cur.clear();
        }
    }
    let trimmed = cur.trim();
    if !trimmed.is_empty() {
        out.push(trimmed.to_string());
    }
    out
}

/// Population variance of per-sentence word counts.
///
/// Human writing is *bursty* — short sentences next to long ones. LLM prose
/// tends toward uniform sentence length, so a low variance is a slop tell.
/// Returns 0.0 for text with fewer than two sentences.
pub fn sentence_variance(text: &str) -> f64 {
    let lens: Vec<f64> = sentences(text)
        .iter()
        .map(|s| word_count(s) as f64)
        .filter(|&n| n > 0.0)
        .collect();
    if lens.len() < 2 {
        return 0.0;
    }
    let mean = lens.iter().sum::<f64>() / lens.len() as f64;
    let var = lens.iter().map(|n| (n - mean).powi(2)).sum::<f64>() / lens.len() as f64;
    var
}

/// Occurrences of `needle` per word (a normalized density, not a raw count, so
/// thresholds are comparable across short and long pages). Used for e.g. the
/// em-dash (`—`) over-use that LLM prose is notorious for.
pub fn char_density(text: &str, needle: char) -> f64 {
    let wc = word_count(text) as f64;
    if wc == 0.0 {
        return 0.0;
    }
    text.chars().filter(|&c| c == needle).count() as f64 / wc
}

/// Fraction of words that appear in `set` (case-insensitive). Drives the
/// filler-word and transition-word metrics.
pub fn word_set_ratio(text: &str, set: &[&str]) -> f64 {
    let ws = words(text);
    if ws.is_empty() {
        return 0.0;
    }
    let hits = ws
        .iter()
        .filter(|w| set.iter().any(|s| w.eq_ignore_ascii_case(s)))
        .count();
    hits as f64 / ws.len() as f64
}

/// Fraction of words ending in `-ly` (length > 3). A crude but stable
/// adverb-density proxy; hype copy and slop lean on adverbs.
pub fn adverb_density(text: &str) -> f64 {
    let ws = words(text);
    if ws.is_empty() {
        return 0.0;
    }
    let hits = ws
        .iter()
        .filter(|w| w.len() > 3 && w.to_ascii_lowercase().ends_with("ly"))
        .count();
    hits as f64 / ws.len() as f64
}

/// Type-token ratio: unique words / total words (case-insensitive).
/// Low diversity = repetitive, padded text.
pub fn lexical_diversity(text: &str) -> f64 {
    let ws = words(text);
    if ws.is_empty() {
        return 0.0;
    }
    let mut seen = std::collections::BTreeSet::new();
    for w in &ws {
        seen.insert(w.to_ascii_lowercase());
    }
    seen.len() as f64 / ws.len() as f64
}

/// N-gram repetition rate: `1 - (unique n-grams / total n-grams)`.
/// High values mean the same phrases recur — templated / spun content.
/// Returns 0.0 when there are too few words to form two n-grams.
pub fn ngram_repetition(text: &str, n: usize) -> f64 {
    let n = n.max(1);
    let ws: Vec<String> = words(text).iter().map(|w| w.to_ascii_lowercase()).collect();
    if ws.len() < n + 1 {
        return 0.0;
    }
    let total = ws.len() - n + 1;
    let mut seen = std::collections::BTreeSet::new();
    for win in ws.windows(n) {
        seen.insert(win.join(" "));
    }
    1.0 - (seen.len() as f64 / total as f64)
}

/// Common low-information filler words.
pub const FILLER_WORDS: &[&str] = &[
    "very", "really", "just", "actually", "basically", "literally", "simply",
    "quite", "rather", "essentially", "certainly", "definitely", "truly",
    "absolutely", "totally", "completely", "extremely", "incredibly",
    "ultimately", "fundamentally",
];

/// Transition / connective words that LLM prose front-loads.
pub const TRANSITION_WORDS: &[&str] = &[
    "however", "moreover", "furthermore", "additionally", "consequently",
    "therefore", "thus", "hence", "nevertheless", "nonetheless", "accordingly",
    "subsequently", "whereas", "notably", "importantly", "indeed",
];
