//! Near-duplicate content detection via simhash over word shingles.
//!
//! Exact duplicates are caught by the content hash; this catches the pages
//! that differ only in boilerplate — templated product/location pages, spun
//! variants, staging copies with a different footer. Each page's normalized
//! text becomes a 64-bit simhash; pages whose hashes differ by ≤
//! [`MAX_HAMMING`] bits are near-duplicates. Candidate pairs are found with
//! banded LSH (four 16-bit bands) so grouping stays near-linear instead of
//! O(n²) over the whole crawl.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};

/// Bit distance at or under which two pages count as near-duplicates.
/// 6/64 bits ≈ 90% feature overlap — the same threshold class the
/// commercial crawlers default to.
const MAX_HAMMING: u32 = 6;

/// Words per shingle. Trigrams balance word-order sensitivity against noise.
const SHINGLE: usize = 3;

/// 64-bit simhash of the page's normalized visible text. Returns `None` for
/// texts too short to fingerprint meaningfully (< 50 words) — tiny pages
/// would otherwise all collide.
pub fn simhash(text: &str) -> Option<u64> {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() < 50 {
        return None;
    }
    let mut weights = [0i32; 64];
    for shingle in words.windows(SHINGLE) {
        let mut h = DefaultHasher::new();
        for w in shingle {
            // Case-insensitive, punctuation-trimmed features.
            w.trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase()
                .hash(&mut h);
        }
        let f = h.finish();
        for (i, w) in weights.iter_mut().enumerate() {
            if f & (1 << i) != 0 {
                *w += 1;
            } else {
                *w -= 1;
            }
        }
    }
    let mut out = 0u64;
    for (i, &w) in weights.iter().enumerate() {
        if w > 0 {
            out |= 1 << i;
        }
    }
    Some(out)
}

/// Similarity of two simhashes as a 0–100 percentage.
pub fn similarity_pct(a: u64, b: u64) -> u8 {
    let same = 64 - (a ^ b).count_ones();
    ((same * 100) / 64) as u8
}

/// Group near-duplicate pages. `items` is `(url, simhash)` per candidate page
/// (200-status HTML with enough text). Returns url → (canonical url,
/// similarity %) for every page that near-duplicates an earlier page.
///
/// Banded LSH: two hashes within [`MAX_HAMMING`] bits almost always share at
/// least one exact 16-bit band, so only pages sharing a band bucket are
/// compared pairwise.
pub fn near_duplicates(items: &[(String, u64)]) -> HashMap<String, (String, u8)> {
    let mut out: HashMap<String, (String, u8)> = HashMap::new();
    // band value -> indices of items in that bucket
    let mut buckets: HashMap<(u8, u16), Vec<usize>> = HashMap::new();
    for (i, (_, h)) in items.iter().enumerate() {
        for band in 0u8..4 {
            let val = ((h >> (band * 16)) & 0xffff) as u16;
            buckets.entry((band, val)).or_default().push(i);
        }
    }
    // For each item, the earliest bucket-mate within the bit threshold wins.
    let mut canon: Vec<Option<(usize, u8)>> = vec![None; items.len()];
    for indices in buckets.values() {
        for (pos, &i) in indices.iter().enumerate().skip(1) {
            for &j in &indices[..pos] {
                if j >= i {
                    continue;
                }
                let dist = (items[i].1 ^ items[j].1).count_ones();
                if dist <= MAX_HAMMING {
                    let pct = similarity_pct(items[i].1, items[j].1);
                    match canon[i] {
                        Some((prev, _)) if prev <= j => {}
                        _ => canon[i] = Some((j, pct)),
                    }
                }
            }
        }
    }
    // Chase to the root so clusters share one canonical URL.
    for (i, c) in canon.iter().enumerate() {
        if let Some((mut root, pct)) = *c {
            while let Some((next, _)) = canon[root] {
                if next >= root {
                    break;
                }
                root = next;
            }
            out.insert(items[i].0.clone(), (items[root].0.clone(), pct));
        }
    }
    out
}

/// Flesch Reading Ease (0–100, higher = easier) for English text. `None` when
/// the text is too short to score meaningfully.
pub fn flesch_reading_ease(text: &str) -> Option<f32> {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() < 100 {
        return None;
    }
    let sentences = text
        .split(['.', '!', '?'])
        .filter(|s| s.split_whitespace().count() >= 2)
        .count()
        .max(1);
    let syllables: usize = words.iter().map(|w| syllables(w)).sum();
    let wc = words.len() as f32;
    let score = 206.835 - 1.015 * (wc / sentences as f32) - 84.6 * (syllables as f32 / wc);
    Some(score.clamp(-100.0, 121.0))
}

/// Rough syllable count: vowel groups, minus silent trailing 'e', min 1.
fn syllables(word: &str) -> usize {
    let w: Vec<char> = word
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if w.is_empty() {
        return 1;
    }
    let is_vowel = |c: char| matches!(c, 'a' | 'e' | 'i' | 'o' | 'u' | 'y');
    let mut count = 0usize;
    let mut prev_vowel = false;
    for &c in &w {
        let v = is_vowel(c);
        if v && !prev_vowel {
            count += 1;
        }
        prev_vowel = v;
    }
    if w.len() > 2 && w.ends_with(&['e']) && !w.ends_with(&['l', 'e']) && count > 1 {
        count -= 1;
    }
    count.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(base: &str, n: usize) -> String {
        (0..n)
            .map(|i| format!("{base}{i}"))
            .collect::<Vec<_>>()
            .join(" ")
    }

    #[test]
    fn identical_text_is_100_pct() {
        let t = words("alpha", 200);
        let a = simhash(&t).unwrap();
        let b = simhash(&t).unwrap();
        assert_eq!(similarity_pct(a, b), 100);
    }

    #[test]
    fn short_text_is_not_fingerprinted() {
        assert!(simhash("too few words here").is_none());
    }

    #[test]
    fn near_duplicates_grouped_but_distinct_pages_are_not() {
        let base: Vec<String> = (0..300).map(|i| format!("word{i}")).collect();
        let a = base.join(" ");
        // ~2% of words changed — still a near-duplicate.
        let mut tweaked = base.clone();
        for i in (0..300).step_by(60) {
            tweaked[i] = format!("changed{i}");
        }
        let b = tweaked.join(" ");
        // A different page entirely.
        let c = words("other", 300);

        let items = vec![
            ("https://x/a".to_string(), simhash(&a).unwrap()),
            ("https://x/b".to_string(), simhash(&b).unwrap()),
            ("https://x/c".to_string(), simhash(&c).unwrap()),
        ];
        let groups = near_duplicates(&items);
        let (canon, pct) = groups.get("https://x/b").expect("b near-dups a");
        assert_eq!(canon, "https://x/a");
        assert!(*pct >= 90, "expected ≥90% similarity, got {pct}");
        assert!(!groups.contains_key("https://x/c"), "c is distinct");
    }

    #[test]
    fn flesch_scores_simple_text_higher() {
        let simple =
            "The cat sat on the mat. It was a big cat. The dog ran to the cat. ".repeat(10);
        let complex = "Notwithstanding institutional heterogeneity, organizational \
            implementations demonstrate considerable multidimensional complexity \
            regarding infrastructural interoperability considerations. "
            .repeat(15);
        let s = flesch_reading_ease(&simple).unwrap();
        let c = flesch_reading_ease(&complex).unwrap();
        assert!(s > c, "simple ({s}) should outscore complex ({c})");
        assert!(s > 60.0, "simple text should be easy, got {s}");
        assert!(c < 30.0, "jargon should be very difficult, got {c}");
    }
}
