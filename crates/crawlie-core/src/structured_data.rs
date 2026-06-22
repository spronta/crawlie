//! Structured-data (JSON-LD) validation. Beyond *detecting* schema.org markup,
//! this checks each item against the properties Google needs for the matching
//! rich result — the same "missing field" errors the Rich Results Test reports —
//! and flags JSON-LD blocks that don't parse at all. Deterministic and offline:
//! no network, no model, just a spec table.

use crate::types::SchemaValidation;
use serde_json::Value;

/// The outcome of validating every JSON-LD block on a page.
pub struct SchemaReport {
    /// Every `@type` found across all parseable blocks (deduped, in order).
    pub types: Vec<String>,
    /// Per-item required/recommended gaps for types we have a spec for.
    pub items: Vec<SchemaValidation>,
    /// JSON-LD `<script>` blocks that failed to parse as JSON.
    pub invalid_blocks: usize,
}

/// Required and recommended properties for a known schema.org type. Required
/// properties make the page ineligible for the rich result when missing;
/// recommended ones strengthen it. Sourced from Google's structured-data docs.
struct Spec {
    type_name: &'static str,
    required: &'static [&'static str],
    recommended: &'static [&'static str],
}

const SPECS: &[Spec] = &[
    Spec {
        type_name: "Article",
        required: &[],
        recommended: &[
            "headline",
            "image",
            "author",
            "datePublished",
            "dateModified",
            "publisher",
        ],
    },
    Spec {
        type_name: "BlogPosting",
        required: &[],
        recommended: &[
            "headline",
            "image",
            "author",
            "datePublished",
            "dateModified",
            "publisher",
        ],
    },
    Spec {
        type_name: "NewsArticle",
        required: &[],
        recommended: &[
            "headline",
            "image",
            "author",
            "datePublished",
            "dateModified",
            "publisher",
        ],
    },
    Spec {
        type_name: "Product",
        required: &["name", "image"],
        recommended: &[
            "description",
            "brand",
            "sku",
            "offers",
            "aggregateRating",
            "review",
        ],
    },
    Spec {
        type_name: "Offer",
        required: &["price", "priceCurrency"],
        recommended: &["availability", "url", "priceValidUntil"],
    },
    Spec {
        type_name: "Recipe",
        required: &["name", "image"],
        recommended: &[
            "recipeIngredient",
            "recipeInstructions",
            "author",
            "datePublished",
            "aggregateRating",
            "prepTime",
            "cookTime",
            "nutrition",
        ],
    },
    Spec {
        type_name: "Event",
        required: &["name", "startDate", "location"],
        recommended: &[
            "endDate",
            "image",
            "description",
            "offers",
            "performer",
            "organizer",
        ],
    },
    Spec {
        type_name: "JobPosting",
        required: &[
            "title",
            "description",
            "datePosted",
            "hiringOrganization",
            "jobLocation",
        ],
        recommended: &["baseSalary", "employmentType", "validThrough"],
    },
    Spec {
        type_name: "FAQPage",
        required: &["mainEntity"],
        recommended: &[],
    },
    Spec {
        type_name: "QAPage",
        required: &["mainEntity"],
        recommended: &[],
    },
    Spec {
        type_name: "BreadcrumbList",
        required: &["itemListElement"],
        recommended: &[],
    },
    Spec {
        type_name: "HowTo",
        required: &["name", "step"],
        recommended: &["image", "totalTime", "supply", "tool"],
    },
    Spec {
        type_name: "VideoObject",
        required: &["name", "description", "thumbnailUrl", "uploadDate"],
        recommended: &["duration", "contentUrl", "embedUrl"],
    },
    Spec {
        type_name: "Organization",
        required: &[],
        recommended: &["name", "url", "logo", "sameAs", "contactPoint"],
    },
    Spec {
        type_name: "LocalBusiness",
        required: &["name", "address"],
        recommended: &[
            "telephone",
            "openingHours",
            "geo",
            "priceRange",
            "image",
            "url",
        ],
    },
    Spec {
        type_name: "Review",
        required: &["itemReviewed", "reviewRating", "author"],
        recommended: &["datePublished", "publisher"],
    },
    Spec {
        type_name: "AggregateRating",
        // `ratingCount`/`reviewCount` handled specially (one-of) below.
        required: &["ratingValue"],
        recommended: &["bestRating", "worstRating"],
    },
    Spec {
        type_name: "Person",
        required: &[],
        recommended: &["name", "url"],
    },
    Spec {
        type_name: "WebSite",
        required: &[],
        recommended: &["name", "url"],
    },
];

fn spec_for(type_name: &str) -> Option<&'static Spec> {
    SPECS
        .iter()
        .find(|s| s.type_name.eq_ignore_ascii_case(type_name))
}

/// A property "counts as present" only if it carries real content: a non-empty
/// string, a non-empty array/object, or any number/bool. Empty strings and
/// empty collections are treated as missing — they don't satisfy Google either.
fn present(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::String(s) => !s.trim().is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
        Value::Bool(_) | Value::Number(_) => true,
    }
}

fn has(obj: &serde_json::Map<String, Value>, key: &str) -> bool {
    obj.get(key).map(present).unwrap_or(false)
}

/// Read an object's `@type` as a list (handles a bare string or an array).
fn type_names(obj: &serde_json::Map<String, Value>) -> Vec<String> {
    match obj.get("@type") {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
        _ => Vec::new(),
    }
}

/// Flatten one parsed JSON-LD value into every typed node it contains. Recurses
/// through arrays, `@graph` containers, and nested objects, so a typed value
/// embedded in a property (an `Offer` inside `Product.offers`, a `Person` inside
/// `author`) is validated in its own right — exactly what Google checks.
fn collect_nodes<'a>(v: &'a Value, out: &mut Vec<&'a serde_json::Map<String, Value>>) {
    match v {
        Value::Array(a) => {
            for item in a {
                collect_nodes(item, out);
            }
        }
        Value::Object(o) => {
            if o.contains_key("@type") {
                out.push(o);
            }
            for val in o.values() {
                collect_nodes(val, out);
            }
        }
        _ => {}
    }
}

/// Validate one typed node against its spec, returning the gaps. Returns `None`
/// for types we don't have a spec for (so we don't penalise unknown markup).
fn validate_node(
    obj: &serde_json::Map<String, Value>,
    type_name: &str,
) -> Option<SchemaValidation> {
    let spec = spec_for(type_name)?;
    let mut missing_required: Vec<String> = spec
        .required
        .iter()
        .filter(|p| !has(obj, p))
        .map(|p| p.to_string())
        .collect();
    let missing_recommended: Vec<String> = spec
        .recommended
        .iter()
        .filter(|p| !has(obj, p))
        .map(|p| p.to_string())
        .collect();

    // Type-specific "one-of" and nested requirements.
    match type_name {
        "AggregateRating" => {
            if !has(obj, "ratingCount") && !has(obj, "reviewCount") {
                missing_required.push("ratingCount|reviewCount".into());
            }
        }
        // A Product is only rich-result eligible with one of these.
        "Product" => {
            if !has(obj, "offers") && !has(obj, "review") && !has(obj, "aggregateRating") {
                missing_required.push("offers|review|aggregateRating".into());
            }
        }
        _ => {}
    }

    if missing_required.is_empty() && missing_recommended.is_empty() {
        return None;
    }
    Some(SchemaValidation {
        type_name: type_name.to_string(),
        missing_required,
        missing_recommended,
    })
}

/// Validate every JSON-LD block on a page. Each string in `blocks` is the raw
/// text of one `<script type="application/ld+json">` element.
pub fn validate(blocks: &[String]) -> SchemaReport {
    let mut types: Vec<String> = Vec::new();
    let mut items: Vec<SchemaValidation> = Vec::new();
    let mut invalid_blocks = 0;

    for block in blocks {
        if block.trim().is_empty() {
            continue;
        }
        let parsed: Value = match serde_json::from_str(block) {
            Ok(v) => v,
            Err(_) => {
                invalid_blocks += 1;
                continue;
            }
        };
        let mut nodes = Vec::new();
        collect_nodes(&parsed, &mut nodes);
        for node in nodes {
            for tn in type_names(node) {
                if !types.contains(&tn) {
                    types.push(tn.clone());
                }
                if let Some(v) = validate_node(node, &tn) {
                    items.push(v);
                }
            }
        }
    }

    SchemaReport {
        types,
        items,
        invalid_blocks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(s: &str) -> Vec<String> {
        vec![s.to_string()]
    }

    #[test]
    fn complete_product_passes() {
        let r = validate(&block(
            r#"{"@context":"https://schema.org","@type":"Product","name":"Widget","image":"https://x/y.jpg","offers":{"@type":"Offer","price":"9.99","priceCurrency":"USD"}}"#,
        ));
        assert!(r.types.contains(&"Product".to_string()));
        assert_eq!(r.invalid_blocks, 0);
        // Product itself is complete; the nested Offer is too.
        assert!(r.items.iter().all(|i| i.missing_required.is_empty()));
    }

    #[test]
    fn product_missing_price_and_name() {
        let r = validate(&block(
            r#"{"@type":"Product","image":"https://x/y.jpg","offers":{"@type":"Offer","priceCurrency":"USD"}}"#,
        ));
        let product = r.items.iter().find(|i| i.type_name == "Product").unwrap();
        assert!(product.missing_required.contains(&"name".to_string()));
        let offer = r.items.iter().find(|i| i.type_name == "Offer").unwrap();
        assert!(offer.missing_required.contains(&"price".to_string()));
    }

    #[test]
    fn invalid_json_is_counted() {
        let r = validate(&block(r#"{"@type":"Product", name: missing-quotes}"#));
        assert_eq!(r.invalid_blocks, 1);
    }

    #[test]
    fn graph_and_type_array_are_flattened() {
        let r = validate(&block(
            r#"{"@graph":[{"@type":["Organization","LocalBusiness"],"name":"Acme"}]}"#,
        ));
        assert!(r.types.contains(&"LocalBusiness".to_string()));
        let lb = r
            .items
            .iter()
            .find(|i| i.type_name == "LocalBusiness")
            .unwrap();
        assert!(lb.missing_required.contains(&"address".to_string()));
    }

    #[test]
    fn aggregate_rating_needs_a_count() {
        let r = validate(&block(r#"{"@type":"AggregateRating","ratingValue":"4.5"}"#));
        let ar = r
            .items
            .iter()
            .find(|i| i.type_name == "AggregateRating")
            .unwrap();
        assert!(ar
            .missing_required
            .iter()
            .any(|m| m.contains("ratingCount")));
    }

    #[test]
    fn unknown_type_is_not_penalised() {
        let r = validate(&block(r#"{"@type":"SomethingObscure","foo":"bar"}"#));
        assert!(r.items.is_empty());
        assert!(r.types.contains(&"SomethingObscure".to_string()));
    }
}
