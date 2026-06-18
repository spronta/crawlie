//! HTML parsing. Runs synchronously (no `.await` while the DOM is alive) so the
//! crawl future stays `Send` and the non-`Send` scraper types never cross an
//! await point. Extracts the full on-page signal set, including GEO signals.

use crate::types::{GeoSignals, Hreflang};
use scraper::{Html, Selector};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use url::Url;

/// On-page data extracted from one HTML document.
pub struct Parsed {
    pub title: Option<String>,
    pub meta_description: Option<String>,
    pub h1: Vec<String>,
    pub h2_count: usize,
    pub h3_count: usize,
    pub canonical: Option<String>,
    pub meta_robots: Option<String>,
    pub lang: Option<String>,
    pub has_viewport: bool,
    pub word_count: usize,
    pub text_ratio: f32,
    pub images_total: usize,
    pub images_missing_alt: usize,
    pub internal_links: Vec<String>,
    pub external_links: Vec<String>,
    pub og_title: Option<String>,
    pub og_image: Option<String>,
    pub twitter_card: Option<String>,
    pub schema_types: Vec<String>,
    pub hreflang: Vec<Hreflang>,
    pub mixed_content: usize,
    pub geo: GeoSignals,
    pub content_hash: Option<String>,
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn sel(s: &str) -> Selector {
    Selector::parse(s).expect("valid selector")
}

/// `www.example.com` and `example.com` count as the same site.
pub fn same_site(seed_host: &str, link_host: &str) -> bool {
    let bare = |h: &str| h.strip_prefix("www.").unwrap_or(h).to_string();
    bare(seed_host) == bare(link_host)
}

fn resolve(base: &Url, href: &str) -> Option<Url> {
    let href = href.trim();
    if href.is_empty()
        || href.starts_with('#')
        || href.starts_with("javascript:")
        || href.starts_with("mailto:")
        || href.starts_with("tel:")
        || href.starts_with("data:")
    {
        return None;
    }
    let mut u = base.join(href).ok()?;
    if u.scheme() != "http" && u.scheme() != "https" {
        return None;
    }
    u.set_fragment(None);
    Some(u)
}

/// Parse one HTML document into structured SEO + GEO data.
pub fn parse_html(body: &str, final_url: &Url, host: &str) -> Parsed {
    let doc = Html::parse_document(body);
    let is_https = final_url.scheme() == "https";

    let title = doc
        .select(&sel("title"))
        .next()
        .map(|e| collapse(&e.text().collect::<String>()))
        .filter(|s| !s.is_empty());

    // --- meta tags (description, robots, viewport, author, og, twitter) ---
    let mut meta_description = None;
    let mut meta_robots = None;
    let mut has_viewport = false;
    let mut og_title = None;
    let mut og_image = None;
    let mut twitter_card = None;
    let mut meta_author = false;
    let mut meta_date = false;
    for el in doc.select(&sel("meta")) {
        let v = el.value();
        let name = v.attr("name").unwrap_or("").to_ascii_lowercase();
        let property = v.attr("property").unwrap_or("").to_ascii_lowercase();
        let content = v.attr("content").unwrap_or("");
        match name.as_str() {
            "description" => meta_description = Some(collapse(content)),
            "robots" => meta_robots = Some(content.to_ascii_lowercase()),
            "viewport" => has_viewport = true,
            "author" => meta_author = !content.trim().is_empty(),
            _ => {}
        }
        if name == "twitter:card" || property == "twitter:card" {
            twitter_card = Some(content.to_string());
        }
        match property.as_str() {
            "og:title" => og_title = Some(content.to_string()),
            "og:image" => og_image = Some(content.to_string()),
            "article:published_time" | "article:modified_time" => meta_date = true,
            _ => {}
        }
    }

    let h1: Vec<String> = doc
        .select(&sel("h1"))
        .map(|e| collapse(&e.text().collect::<String>()))
        .filter(|s| !s.is_empty())
        .collect();
    let h2_count = doc.select(&sel("h2")).count();
    let h3_count = doc.select(&sel("h3")).count();

    // question-style headings (great for AI answer extraction)
    let question_headings = doc
        .select(&sel("h1, h2, h3"))
        .filter(|e| {
            collapse(&e.text().collect::<String>())
                .trim_end()
                .ends_with('?')
        })
        .count();

    // canonical + hreflang from <link>
    let mut canonical = None;
    let mut hreflang = Vec::new();
    for el in doc.select(&sel("link")) {
        let rel = el.value().attr("rel").unwrap_or("");
        let rels: Vec<String> = rel
            .split_whitespace()
            .map(|r| r.to_ascii_lowercase())
            .collect();
        if rels.iter().any(|r| r == "canonical") {
            if let Some(c) = el.value().attr("href").and_then(|h| resolve(final_url, h)) {
                canonical = Some(c.to_string());
            }
        }
        if rels.iter().any(|r| r == "alternate") {
            if let (Some(lang), Some(href)) = (el.value().attr("hreflang"), el.value().attr("href"))
            {
                hreflang.push(Hreflang {
                    lang: lang.to_string(),
                    href: final_url
                        .join(href.trim())
                        .map(|u| u.to_string())
                        .unwrap_or_else(|_| href.to_string()),
                });
            }
        }
    }

    let lang = doc
        .select(&sel("html"))
        .next()
        .and_then(|e| e.value().attr("lang"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // images
    let mut images_total = 0;
    let mut images_missing_alt = 0;
    for el in doc.select(&sel("img")) {
        images_total += 1;
        let alt = el.value().attr("alt");
        if alt.map(|a| a.trim().is_empty()).unwrap_or(true) {
            images_missing_alt += 1;
        }
    }

    // body text → word count, text ratio, content hash
    let body_text = doc
        .select(&sel("body"))
        .next()
        .map(|b| b.text().collect::<Vec<_>>().join(" "))
        .unwrap_or_default();
    let normalized = collapse(&body_text);
    let word_count = normalized.split_whitespace().count();
    let text_ratio = if body.is_empty() {
        0.0
    } else {
        (normalized.len() as f32 / body.len() as f32).min(1.0)
    };
    let content_hash = if word_count >= 20 {
        let mut hasher = DefaultHasher::new();
        normalized.to_ascii_lowercase().hash(&mut hasher);
        Some(format!("{:016x}", hasher.finish()))
    } else {
        None
    };

    // links
    let mut internal_links = Vec::new();
    let mut external_links = Vec::new();
    let mut seen = HashSet::new();
    for el in doc.select(&sel("a[href]")) {
        if let Some(u) = el.value().attr("href").and_then(|h| resolve(final_url, h)) {
            let key = u.as_str().to_string();
            if !seen.insert(key.clone()) {
                continue;
            }
            match u.host_str() {
                Some(h) if same_site(host, h) => internal_links.push(key),
                Some(_) => external_links.push(key),
                None => {}
            }
        }
    }

    // mixed content: insecure sub-resources on an https page
    let mut mixed_content = 0;
    if is_https {
        for el in doc.select(&sel("img[src], script[src], link[href], iframe[src], source[src], video[src], audio[src], embed[src], object[data]")) {
            let v = el.value();
            let attr = v.attr("src").or_else(|| v.attr("href")).or_else(|| v.attr("data")).unwrap_or("");
            if attr.trim_start().starts_with("http://") {
                mixed_content += 1;
            }
        }
    }

    // structured data (JSON-LD)
    let mut schema_types = Vec::new();
    let mut json_ld_text = String::new();
    for el in doc.select(&sel(r#"script[type="application/ld+json"]"#)) {
        json_ld_text.push_str(&el.text().collect::<String>());
        json_ld_text.push('\n');
    }
    for t in extract_schema_types(&json_ld_text) {
        if !schema_types.contains(&t) {
            schema_types.push(t);
        }
    }
    let structured_data = !schema_types.is_empty();
    let faq_schema = schema_types
        .iter()
        .any(|t| matches!(t.as_str(), "FAQPage" | "QAPage" | "Question"));
    let lc = json_ld_text.to_ascii_lowercase();
    let has_author = meta_author
        || lc.contains("\"author\"")
        || doc
            .select(&sel("[rel~=author], .author, .byline"))
            .next()
            .is_some();
    let has_date = meta_date
        || lc.contains("\"datepublished\"")
        || doc.select(&sel("time[datetime]")).next().is_some();

    // semantic structure & answerability
    let semantic_html = doc.select(&sel("main, article")).next().is_some();
    let structured_blocks = doc.select(&sel("ul, ol, table")).count();
    // "answerable" ≈ a substantial paragraph exists early in the main content.
    let answerable = doc.select(&sel("main p, article p, p")).take(3).any(|p| {
        collapse(&p.text().collect::<String>())
            .split_whitespace()
            .count()
            >= 25
    });

    let geo = GeoSignals {
        semantic_html,
        structured_data,
        has_author,
        has_date,
        faq_schema,
        question_headings,
        structured_blocks,
        answerable,
        score: 0, // filled by scoring::geo_score
    };

    Parsed {
        title,
        meta_description,
        h1,
        h2_count,
        h3_count,
        canonical,
        meta_robots,
        lang,
        has_viewport,
        word_count,
        text_ratio,
        images_total,
        images_missing_alt,
        internal_links,
        external_links,
        og_title,
        og_image,
        twitter_card,
        schema_types,
        hreflang,
        mixed_content,
        geo,
        content_hash,
    }
}

/// Pull `@type` string values out of JSON-LD text without a full JSON parse
/// (handles arrays, nesting, and `@graph`).
fn extract_schema_types(json: &str) -> Vec<String> {
    let mut types = Vec::new();
    let mut rest = json;
    while let Some(idx) = rest.find("\"@type\"") {
        rest = &rest[idx + 7..];
        // skip whitespace and ':'
        let after = rest.trim_start();
        let after = after.strip_prefix(':').unwrap_or(after).trim_start();
        if let Some(stripped) = after.strip_prefix('"') {
            if let Some(end) = stripped.find('"') {
                types.push(stripped[..end].to_string());
            }
        } else if let Some(stripped) = after.strip_prefix('[') {
            // array of types
            if let Some(end) = stripped.find(']') {
                for part in stripped[..end].split(',') {
                    let t = part.trim().trim_matches('"').trim();
                    if !t.is_empty() {
                        types.push(t.to_string());
                    }
                }
            }
        }
    }
    types
}
