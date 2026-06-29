//! HTML parsing. Runs synchronously (no `.await` while the DOM is alive) so the
//! crawl future stays `Send` and the non-`Send` scraper types never cross an
//! await point. Extracts the full on-page signal set, including GEO signals.

use crate::structured_data;
use crate::types::{A11ySignals, ExtractValue, Extractor, GeoSignals, Hreflang, SchemaValidation};
use scraper::{ElementRef, Html, Node, Selector};
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
    pub text: Option<String>,
    pub images_total: usize,
    pub images_missing_alt: usize,
    pub internal_links: Vec<String>,
    pub external_links: Vec<String>,
    pub og_title: Option<String>,
    pub og_image: Option<String>,
    pub twitter_card: Option<String>,
    pub schema_types: Vec<String>,
    pub schema_validations: Vec<SchemaValidation>,
    pub invalid_jsonld: usize,
    pub hreflang: Vec<Hreflang>,
    pub mixed_content: usize,
    pub geo: GeoSignals,
    pub a11y: A11ySignals,
    pub content_hash: Option<String>,
    pub extractions: Vec<ExtractValue>,
}

/// Validate that every extractor's selector/regex compiles, returning a
/// human-readable error for the first bad one. Called before a crawl starts so
/// a typo fails fast instead of silently extracting nothing.
pub fn validate_extractors(extractors: &[Extractor]) -> Result<(), String> {
    for ex in extractors {
        if let Some(css) = &ex.css {
            Selector::parse(css)
                .map_err(|e| format!("extractor '{}': invalid CSS selector — {e:?}", ex.name))?;
        } else if let Some(pat) = &ex.regex {
            regex::Regex::new(pat)
                .map_err(|e| format!("extractor '{}': invalid regex — {e}", ex.name))?;
        } else {
            return Err(format!(
                "extractor '{}': needs a css selector or regex",
                ex.name
            ));
        }
    }
    Ok(())
}

/// Cap on values captured per extractor per page (guards against runaway regex
/// or selectors that match thousands of nodes).
const EXTRACT_CAP: usize = 50;

#[cfg(test)]
mod extract_tests {
    use super::*;

    fn ex(name: &str, css: Option<&str>, attr: Option<&str>, regex: Option<&str>) -> Extractor {
        Extractor {
            name: name.into(),
            css: css.map(Into::into),
            attr: attr.map(Into::into),
            regex: regex.map(Into::into),
        }
    }

    #[test]
    fn a11y_signals_detected() {
        let html = "<!doctype html><html lang=\"en\"><head><title>t</title>\
            <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, user-scalable=no\"></head><body>\
            <a href=\"/a\">Read more</a>\
            <a href=\"/b\"><img src=\"i.png\" alt=\"\"></a>\
            <button></button>\
            <button aria-label=\"Close\"></button>\
            <label for=\"named\">Email</label><input id=\"named\" type=\"text\">\
            <input id=\"bare\" type=\"text\">\
            <iframe src=\"/embed\"></iframe>\
            <div tabindex=\"3\">x</div>\
            <h2>Section</h2><h4>Skipped</h4></body></html>";
        let url = Url::parse("https://example.com/p").unwrap();
        let p = parse_html(html, &url, "example.com", &[]).a11y;
        assert_eq!(p.links_total, 2);
        assert_eq!(p.links_no_text, 1, "icon link with empty alt is unnamed");
        assert_eq!(
            p.buttons_no_text, 1,
            "only the aria-labelled button is named"
        );
        assert_eq!(p.controls_total, 2);
        assert_eq!(p.inputs_no_label, 1, "the bare input has no label");
        assert_eq!(p.iframes_no_title, 1);
        assert_eq!(p.positive_tabindex, 1);
        assert!(p.skipped_heading, "h2 -> h4 skips a level");
        assert!(p.viewport_blocks_zoom, "user-scalable=no blocks zoom");
    }

    #[test]
    fn css_regex_and_attr_extraction() {
        let html = "<!doctype html><html><head><title>t</title></head><body>\
            <div class=\"price\">$19.99</div><div class=\"price\">$5</div>\
            <a class=\"author\" href=\"/jane\">Jane Doe</a>\
            <p>Product SKU-123 in stock</p></body></html>";
        let url = Url::parse("https://shop.example/p").unwrap();
        let extractors = vec![
            ex("price", Some(".price"), None, None),
            ex("author_url", Some("a.author"), Some("href"), None),
            ex("sku", None, None, Some(r"SKU-(\d+)")),
            ex("missing", Some(".nope"), None, None),
        ];
        let parsed = parse_html(html, &url, "shop.example", &extractors);
        let by = |n: &str| parsed.extractions.iter().find(|e| e.name == n).cloned();

        assert_eq!(by("price").unwrap().values, vec!["$19.99", "$5"]);
        assert_eq!(by("author_url").unwrap().values, vec!["/jane"]);
        assert_eq!(by("sku").unwrap().values, vec!["123"]);
        // Extractors that match nothing are omitted entirely.
        assert!(by("missing").is_none());
    }
}

/// Run the configured extractors over one document, returning a value list per
/// extractor (omitting extractors that matched nothing). Selectors/regexes are
/// expected to be pre-validated by the caller; invalid ones are skipped.
fn run_extractors(doc: &Html, body: &str, extractors: &[Extractor]) -> Vec<ExtractValue> {
    let mut out = Vec::new();
    for ex in extractors {
        let mut values: Vec<String> = Vec::new();
        if let Some(css) = &ex.css {
            if let Ok(sel) = Selector::parse(css) {
                for el in doc.select(&sel) {
                    if values.len() >= EXTRACT_CAP {
                        break;
                    }
                    let v = match &ex.attr {
                        Some(a) => el.value().attr(a).map(|s| s.trim().to_string()),
                        None => {
                            let t = collapse(&el.text().collect::<String>());
                            (!t.is_empty()).then_some(t)
                        }
                    };
                    if let Some(v) = v.filter(|s| !s.is_empty()) {
                        values.push(v);
                    }
                }
            }
        } else if let Some(pat) = &ex.regex {
            if let Ok(re) = regex::Regex::new(pat) {
                for caps in re.captures_iter(body).take(EXTRACT_CAP) {
                    // Capture group 1 if the pattern has one, else the whole match.
                    let m = caps.get(1).or_else(|| caps.get(0));
                    if let Some(m) = m {
                        let v = m.as_str().trim();
                        if !v.is_empty() {
                            values.push(v.to_string());
                        }
                    }
                }
            }
        }
        if !values.is_empty() {
            out.push(ExtractValue {
                name: ex.name.clone(),
                values,
            });
        }
    }
    out
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Accumulate the visible text under `el`, skipping the contents of elements
/// that hold code/data rather than reading content (`script`, `style`,
/// `noscript`, `template`). The space-joining keeps adjacent words separated.
fn collect_visible_text(el: ElementRef, out: &mut String) {
    for child in el.children() {
        match child.value() {
            Node::Text(t) => {
                out.push_str(t);
                out.push(' ');
            }
            Node::Element(e) => {
                if matches!(e.name(), "script" | "style" | "noscript" | "template") {
                    continue;
                }
                if let Some(child_el) = ElementRef::wrap(child) {
                    collect_visible_text(child_el, out);
                }
            }
            _ => {}
        }
    }
}

fn sel(s: &str) -> Selector {
    Selector::parse(s).expect("valid selector")
}

/// True if the element carries an explicit accessible name via an ARIA/`title`
/// attribute (`aria-label`, `aria-labelledby`, or a non-empty `title`).
fn has_aria_name(el: &ElementRef) -> bool {
    let v = el.value();
    ["aria-label", "aria-labelledby", "title"]
        .iter()
        .any(|a| v.attr(a).map(|s| !s.trim().is_empty()).unwrap_or(false))
}

/// True if a descendant `<img>` supplies a non-empty `alt` (so e.g. an icon link
/// is still named for assistive tech).
fn has_named_image(el: &ElementRef) -> bool {
    el.select(&sel("img")).any(|img| {
        img.value()
            .attr("alt")
            .map(|a| !a.trim().is_empty())
            .unwrap_or(false)
    })
}

/// Whether a viewport `content` value blocks the user from zooming —
/// `user-scalable=no/0`, or `maximum-scale` below 2 (WCAG 1.4.4 wants 200%).
fn viewport_blocks_zoom(content: &str) -> bool {
    for part in content.split(',') {
        let mut kv = part.splitn(2, '=');
        let key = kv.next().unwrap_or("").trim().to_ascii_lowercase();
        let val = kv.next().unwrap_or("").trim().to_ascii_lowercase();
        match key.as_str() {
            "user-scalable" if val == "no" || val == "0" => return true,
            "maximum-scale" if val.parse::<f32>().map(|n| n < 2.0).unwrap_or(false) => return true,
            _ => {}
        }
    }
    false
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
pub fn parse_html(body: &str, final_url: &Url, host: &str, extractors: &[Extractor]) -> Parsed {
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
    let mut viewport_content: Option<String> = None;
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
            "viewport" => {
                has_viewport = true;
                viewport_content = Some(content.to_string());
            }
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

    // body text → word count, text ratio, content hash. Excludes the contents of
    // <script>/<style>/<noscript>/<template>: scraper's `.text()` would otherwise
    // count inline JS, JSON data and CSS as "words", inflating the count (and, on
    // client-rendered pages, masking how little real content is in the raw HTML).
    let body_text = doc
        .select(&sel("body"))
        .next()
        .map(|b| {
            let mut s = String::new();
            collect_visible_text(b, &mut s);
            s
        })
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

    // structured data (JSON-LD): collect each <script> block separately so we
    // can validate it as standalone JSON, then check it against Google's
    // rich-result requirements.
    let mut json_ld_blocks: Vec<String> = Vec::new();
    let mut json_ld_text = String::new();
    for el in doc.select(&sel(r#"script[type="application/ld+json"]"#)) {
        let block = el.text().collect::<String>();
        json_ld_text.push_str(&block);
        json_ld_text.push('\n');
        json_ld_blocks.push(block);
    }
    let schema_report = structured_data::validate(&json_ld_blocks);
    let mut schema_types = schema_report.types.clone();
    // Union in any types from blocks that failed JSON parsing (the string scan
    // still finds @type), so detection never regresses on malformed markup.
    if schema_report.invalid_blocks > 0 {
        for t in extract_schema_types(&json_ld_text) {
            if !schema_types.contains(&t) {
                schema_types.push(t);
            }
        }
    }
    let schema_validations = schema_report.items;
    let invalid_jsonld = schema_report.invalid_blocks;
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

    // --- Accessibility (static WCAG checks) ---
    let mut a11y = A11ySignals::default();

    // Links with no accessible name (no text, ARIA/title, or alt-bearing image).
    for el in doc.select(&sel("a[href]")) {
        a11y.links_total += 1;
        let has_text = !collapse(&el.text().collect::<String>()).is_empty();
        if !has_text && !has_aria_name(&el) && !has_named_image(&el) {
            a11y.links_no_text += 1;
        }
    }

    // Buttons with no accessible name. `<button>` reads its text; button-type
    // `<input>` reads its `value` attribute.
    for el in doc.select(&sel(
        r#"button, input[type="button"], input[type="submit"], input[type="reset"]"#,
    )) {
        a11y.buttons_total += 1;
        let v = el.value();
        let has_text = if v.name() == "input" {
            v.attr("value")
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false)
        } else {
            !collapse(&el.text().collect::<String>()).is_empty()
        };
        if !has_text && !has_aria_name(&el) && !has_named_image(&el) {
            a11y.buttons_no_text += 1;
        }
    }

    // Form controls with no associated label. A control is named by a wrapping
    // `<label>`, a `<label for=id>`, an `aria-label`/`aria-labelledby`, or `title`.
    let label_for: HashSet<String> = doc
        .select(&sel("label[for]"))
        .filter_map(|l| l.value().attr("for").map(|s| s.to_string()))
        .collect();
    for el in doc.select(&sel("input, select, textarea")) {
        let v = el.value();
        // Inputs that take no visible label (hidden/buttons/image) don't apply.
        if v.name() == "input" {
            let ty = v.attr("type").unwrap_or("text").to_ascii_lowercase();
            if matches!(
                ty.as_str(),
                "hidden" | "submit" | "button" | "reset" | "image"
            ) {
                continue;
            }
        }
        a11y.controls_total += 1;
        let labelled = has_aria_name(&el)
            || v.attr("id")
                .map(|id| label_for.contains(id))
                .unwrap_or(false)
            || el.ancestors().any(|n| {
                n.value()
                    .as_element()
                    .map(|e| e.name() == "label")
                    .unwrap_or(false)
            });
        if !labelled {
            a11y.inputs_no_label += 1;
        }
    }

    // Iframes with no accessible name.
    for el in doc.select(&sel("iframe")) {
        if !has_aria_name(&el) {
            a11y.iframes_no_title += 1;
        }
    }

    // Positive tabindex (anything > 0 hijacks the natural focus order).
    for el in doc.select(&sel("[tabindex]")) {
        if el
            .value()
            .attr("tabindex")
            .and_then(|t| t.trim().parse::<i32>().ok())
            .map(|n| n > 0)
            .unwrap_or(false)
        {
            a11y.positive_tabindex += 1;
        }
    }

    // Heading order: flag a downward jump of more than one level (e.g. h2 → h4).
    let mut last_level = 0u8;
    for el in doc.select(&sel("h1, h2, h3, h4, h5, h6")) {
        let level = el.value().name().as_bytes()[1] - b'0';
        if last_level != 0 && level > last_level + 1 {
            a11y.skipped_heading = true;
        }
        last_level = level;
    }

    a11y.viewport_blocks_zoom = viewport_content
        .as_deref()
        .map(viewport_blocks_zoom)
        .unwrap_or(false);

    let text = if normalized.is_empty() {
        None
    } else {
        Some(normalized.clone())
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
        text,
        images_total,
        images_missing_alt,
        internal_links,
        external_links,
        og_title,
        og_image,
        twitter_card,
        schema_types,
        schema_validations,
        invalid_jsonld,
        hreflang,
        mixed_content,
        geo,
        a11y,
        content_hash,
        extractions: run_extractors(&doc, body, extractors),
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
