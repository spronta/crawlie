//! The "why it matters" knowledge base. Every audit rule maps to plain-language
//! guidance: why it matters, how to fix it, and the impact of ignoring it.
//! Surfaced in the desktop app, the CLI (`crawlie explain <rule>`), the MCP
//! `explain_issue` tool, and exported HTML reports.

use crate::types::{Category, RuleInfo, Severity};

struct Entry {
    rule: &'static str,
    title: &'static str,
    category: Category,
    severity: Severity,
    why: &'static str,
    how: &'static str,
    impact: &'static str,
}

macro_rules! entries {
    ($($rule:literal => $title:literal, $cat:expr, $sev:expr, $why:literal, $how:literal, $impact:literal);+ $(;)?) => {
        const ENTRIES: &[Entry] = &[
            $(Entry { rule: $rule, title: $title, category: $cat, severity: $sev, why: $why, how: $how, impact: $impact }),+
        ];
    };
}

use Category::*;
use Severity::*;

entries! {
    // ---- Response ----
    "connection-error" => "Connection Error", Response, Error,
        "The server didn't respond at all — DNS failure, timeout, or a refused connection. Search engines that can't reach a URL can't index it, and users hit a dead end.",
        "Confirm the URL is correct and the host is reachable. Check DNS, server uptime, firewall rules, and that your server isn't rate-limiting the crawler.",
        "Completely invisible to search engines and inaccessible to users.";
    "server-error" => "Server Error (5xx)", Response, Error,
        "A 5xx means your server failed to deliver the page. Persistent 5xx errors cause search engines to slow crawling and eventually drop the URL from the index.",
        "Inspect server logs for the failing request, fix the underlying application/server fault, and return a 200 once healthy. Use 503 with Retry-After only for planned maintenance.",
        "Lost rankings and crawl budget; users can't access the page.";
    "client-error" => "Client Error (4xx)", Response, Error,
        "A 4xx (usually 404) means the page is gone or the URL is wrong. Internal links pointing to 4xx pages waste crawl budget and leak link equity into dead ends.",
        "Restore the page, or 301-redirect the URL to the best alternative, and fix any internal links that point to it. Return a proper 404 for genuinely removed content.",
        "Broken user journeys and wasted crawl budget; equity from inbound links is lost.";
    "redirect" => "Redirect (3xx)", Response, Warning,
        "A 3xx adds a round-trip before the real content loads and dilutes link signals slightly. A few are fine; many internal links to redirects add up.",
        "Update internal links to point straight at the final destination URL so crawlers and users skip the hop.",
        "Slower loads and minor signal dilution across the site.";
    "redirect-chain" => "Redirect Chain", Response, Warning,
        "Multiple hops (A→B→C) compound latency and risk a hop breaking. Some crawlers stop following after a few redirects, abandoning the final page.",
        "Collapse the chain so the first URL redirects directly to the final destination in a single hop.",
        "Wasted crawl budget, slower pages, and a risk the destination is never reached.";
    "slow-response" => "Slow Response", Response, Notice,
        "Slow server responses (high TTFB) hurt Core Web Vitals, frustrate users, and limit how many pages a crawler will fetch per visit.",
        "Add caching/CDN, optimize database queries, enable keep-alive and compression, and move to faster hosting if needed.",
        "Lower rankings via Core Web Vitals and reduced crawl coverage.";

    // ---- Links ----
    "broken-link" => "Broken Link", Links, Error,
        "A link on this page points to a URL that returns an error. Broken links erode trust, waste crawl budget, and send users and bots to dead ends.",
        "Fix the link target, update it to the correct URL, or remove the link. Re-check periodically as external targets change.",
        "Poor user experience and leaked link equity into broken destinations.";
    "orphan" => "Orphan Page", Links, Notice,
        "No internal links point to this page, so users and crawlers can only reach it via the sitemap or external links. Orphans get crawled rarely and rank poorly.",
        "Add internal links to the page from relevant, in-context locations (navigation, related content, hub pages).",
        "Reduced discoverability, crawl frequency, and ranking potential.";
    "deep-page" => "Deep Page", Links, Notice,
        "This page is many clicks from the homepage. Pages buried deep in the architecture receive less crawl attention and less internal link equity.",
        "Flatten your site architecture so important pages sit within ~3 clicks of the homepage via hub pages and contextual links.",
        "Slower indexing and weaker rankings for deep content.";

    // ---- Titles & Meta ----
    "title-missing" => "Missing Title", TitlesMeta, Error,
        "The title tag is the single most important on-page SEO element and the clickable headline in search results. Without one, engines invent one — usually badly.",
        "Add a unique, descriptive <title> of roughly 30–60 characters that includes the page's primary keyword near the front.",
        "Drastically reduced click-through and ranking for the page.";
    "title-too-long" => "Title Too Long", TitlesMeta, Warning,
        "Titles over ~60 characters get truncated in search results, hiding the end of your message and reducing click-through.",
        "Tighten the title to under ~60 characters, front-loading the most important words.",
        "Truncated, less compelling search snippets.";
    "title-too-short" => "Title Too Short", TitlesMeta, Notice,
        "Very short titles waste valuable space in the search result and often omit useful keywords searchers use.",
        "Expand the title to ~30–60 characters with descriptive, keyword-relevant wording.",
        "Missed keyword relevance and weaker click-through.";
    "title-duplicate" => "Duplicate Title", TitlesMeta, Warning,
        "Multiple pages share the same title, so search engines struggle to tell them apart and may pick the wrong one to rank.",
        "Give every page a unique title that reflects its specific content.",
        "Keyword cannibalisation and diluted ranking signals.";
    "description-missing" => "Missing Meta Description", TitlesMeta, Warning,
        "The meta description is your ad copy in search results. Without one, engines auto-generate a snippet from page text, often unappealing.",
        "Write a unique, compelling 70–160 character description that summarises the page and invites the click.",
        "Lower click-through from search results.";
    "description-too-long" => "Meta Description Too Long", TitlesMeta, Notice,
        "Descriptions beyond ~160 characters are truncated, cutting off your call to action.",
        "Trim to ~70–160 characters and put the key message first.",
        "Truncated snippets with weaker messaging.";
    "description-too-short" => "Meta Description Too Short", TitlesMeta, Notice,
        "Very short descriptions under-use the snippet space and rarely persuade the searcher.",
        "Expand to ~70–160 characters with a clear summary and benefit.",
        "Under-leveraged search real estate.";
    "description-duplicate" => "Duplicate Meta Description", TitlesMeta, Warning,
        "Reused descriptions across pages make snippets generic and signal thin differentiation to search engines.",
        "Write a distinct description for each page.",
        "Generic snippets and weaker differentiation.";

    // ---- Headings ----
    "h1-missing" => "Missing H1", Headings, Warning,
        "The H1 is the page's main on-page heading; it tells users and engines (and increasingly AI answer engines) what the page is about.",
        "Add exactly one clear, descriptive <h1> that summarises the page's topic.",
        "Weaker topical clarity for search and AI extraction.";
    "h1-multiple" => "Multiple H1", Headings, Notice,
        "Several H1s blur the page's primary topic and weaken the heading hierarchy that crawlers and screen readers rely on.",
        "Keep a single H1 and demote the rest to H2/H3 to form a clean outline.",
        "Diluted topical focus and accessibility issues.";

    // ---- Indexability ----
    "noindex" => "Noindex", Indexability, Warning,
        "A noindex directive tells search engines to keep this page out of their index. Intentional for thank-you/admin pages — disastrous if applied by mistake.",
        "Confirm the noindex is intended. If the page should rank, remove the noindex from the meta robots tag or X-Robots-Tag header.",
        "The page cannot appear in search results.";
    "nofollow" => "Nofollow", Indexability, Notice,
        "A page-level nofollow stops link equity flowing from this page's links, which can strand the pages it links to.",
        "Remove the blanket nofollow unless you deliberately want to seal off link flow from this page.",
        "Reduced crawl discovery and equity distribution.";
    "x-robots-noindex" => "X-Robots-Tag: noindex", Indexability, Warning,
        "A noindex set via HTTP header is easy to overlook because it isn't visible in the HTML, yet it removes the page from search just the same.",
        "Audit your server/CDN config and remove the X-Robots-Tag noindex if the page should be indexable.",
        "Silent de-indexing that's hard to spot.";
    "blocked-by-robots" => "Blocked by robots.txt", Indexability, Warning,
        "robots.txt is preventing crawlers from fetching this URL. Blocked pages can't be crawled, and if linked, may show up in results with no snippet.",
        "If the page should be crawled, remove or narrow the Disallow rule. Use noindex (not robots.txt) to keep a page out of the index.",
        "The page's content is invisible to search engines.";

    // ---- Canonicals ----
    "canonical-missing" => "Missing Canonical", Canonical, Notice,
        "Without a canonical tag, search engines guess which URL version is authoritative, risking duplicate-content splits across parameters and variants.",
        "Add a self-referencing <link rel=\"canonical\"> on each page pointing to its preferred URL.",
        "Duplicate-content ambiguity and split ranking signals.";
    "canonicalised" => "Canonicalised", Canonical, Notice,
        "This page's canonical points to a different URL, so engines treat the other URL as the one to index. Fine when deliberate, harmful when accidental.",
        "Verify the canonical target is correct. If this page should rank on its own, point the canonical at itself.",
        "The page may be dropped from the index in favour of the canonical target.";

    // ---- Images ----
    "image-missing-alt" => "Images Missing Alt Text", Images, Warning,
        "Alt text describes images to screen-reader users and to search engines (powering image search). Missing alt hurts accessibility and discoverability.",
        "Add concise, descriptive alt attributes to meaningful images; use empty alt=\"\" for purely decorative ones.",
        "Accessibility failures and lost image-search traffic.";

    // ---- Content ----
    "thin-content" => "Thin Content", Content, Notice,
        "Pages with very little content rarely satisfy search intent and are easily out-competed. AI answer engines also skip pages that lack substance.",
        "Expand the page with genuinely useful, original content that fully answers the user's question.",
        "Weak rankings and low citation in AI answers.";
    "large-page" => "Large Page Size", Performance, Notice,
        "A heavy HTML payload slows rendering and parsing, hurting Core Web Vitals and mobile users on slow connections.",
        "Reduce inline scripts/styles, lazy-load below-the-fold content, and trim unnecessary markup.",
        "Slower loads and weaker Core Web Vitals scores.";
    "duplicate-content" => "Duplicate Content", Content, Warning,
        "Two or more pages share near-identical content. Search engines must choose one to rank and may pick the wrong one, splitting signals across the duplicates.",
        "Consolidate duplicates with 301 redirects or canonical tags, or differentiate the content so each page serves a distinct intent.",
        "Diluted rankings and wasted crawl budget.";
    "low-text-ratio" => "Low Text-to-HTML Ratio", Content, Notice,
        "A page that is mostly markup with little readable text often signals thin or template-heavy content to search and AI engines.",
        "Increase the proportion of meaningful body text relative to code, and remove bloated markup.",
        "Perceived as low-value, reducing ranking and citation.";

    // ---- Security ----
    "not-secure" => "Not Served Over HTTPS", Security, Warning,
        "HTTPS is a confirmed ranking signal and a baseline trust requirement. Browsers flag HTTP pages as 'Not secure', scaring users away.",
        "Install a TLS certificate and 301-redirect all HTTP URLs to their HTTPS equivalents site-wide.",
        "Lower trust, browser warnings, and a ranking disadvantage.";
    "mixed-content" => "Mixed Content", Security, Warning,
        "An HTTPS page is loading resources over insecure HTTP. Browsers block or warn on mixed content, breaking layout and eroding the security guarantee.",
        "Update all resource URLs (images, scripts, styles) to HTTPS, or use protocol-relative/upgrade-insecure-requests.",
        "Broken assets and browser security warnings.";
    "no-hsts" => "No HSTS Header", Security, Notice,
        "Without HTTP Strict Transport Security, the first request can be downgraded to HTTP, exposing users to interception on that initial hop.",
        "Send a Strict-Transport-Security header with a long max-age once you're confident all subdomains are HTTPS.",
        "A small but real man-in-the-middle exposure window.";

    // ---- Performance ----
    "no-compression" => "No Text Compression", Performance, Notice,
        "Serving HTML without gzip/brotli sends far more bytes than necessary, slowing every page load.",
        "Enable gzip or brotli compression for text responses at your server or CDN.",
        "Slower page loads and higher bandwidth use.";

    // ---- Mobile ----
    "viewport-missing" => "Missing Viewport", Mobile, Warning,
        "The viewport meta tag is required for responsive layouts. Without it, mobile browsers render a zoomed-out desktop page that's unusable on phones.",
        "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> to the <head>.",
        "Broken mobile experience and mobile-first ranking penalties.";

    // ---- International ----
    "lang-missing" => "Missing Lang Attribute", International, Notice,
        "The html lang attribute tells browsers, screen readers, and search engines what language the page is in.",
        "Set the language on the root element, e.g. <html lang=\"en\">.",
        "Accessibility issues and weaker language targeting.";
    "hreflang-incomplete" => "Incomplete hreflang", International, Notice,
        "hreflang annotations help engines serve the right language/region version. Incomplete or non-reciprocal hreflang confuses targeting.",
        "Ensure every language variant lists all others (including itself) with valid language-region codes and a return link.",
        "Wrong-language pages shown to users in search results.";

    // ---- Social ----
    "og-missing" => "Missing Open Graph Tags", Social, Notice,
        "Open Graph tags control how the page looks when shared on social platforms and in chat apps. Without them, shares get an unattractive, generic preview.",
        "Add og:title, og:description, and og:image (plus a Twitter card) to the <head>.",
        "Poor social share previews and lower click-through from social.";
    "twitter-missing" => "Missing Twitter Card", Social, Notice,
        "Twitter/X card tags define the rich preview when your page is shared there.",
        "Add twitter:card (and optionally twitter:title/description/image) meta tags.",
        "Plain-text social previews that earn fewer clicks.";

    // ---- Structured Data ----
    "structured-data-missing" => "No Structured Data", StructuredData, Notice,
        "Schema.org structured data unlocks rich results (stars, FAQs, breadcrumbs) and is increasingly how AI engines understand and cite a page.",
        "Add relevant JSON-LD (Article, Product, FAQPage, BreadcrumbList, Organization) matching the page's content.",
        "No rich results and reduced machine understanding of the page.";

    // ---- GEO (Generative Engine Optimization) ----
    "geo-no-structured-data" => "GEO: No Machine-Readable Structure", Geo, Warning,
        "Generative engines (ChatGPT, Perplexity, Google AI Overviews) lean on structured data and clean semantics to understand and cite sources. Pages without it are harder to quote accurately.",
        "Add JSON-LD structured data and use semantic HTML so AI can parse entities, facts, and relationships reliably.",
        "Lower likelihood of being cited in AI-generated answers.";
    "geo-not-answerable" => "GEO: Not Answer-Ready", Geo, Notice,
        "AI answer engines extract concise answers that sit directly under a clear heading. Pages that bury the answer in long prose are harder to quote.",
        "Lead each section with the direct answer in the first sentence after the heading, then elaborate. Use question-style headings.",
        "Passed over by AI engines in favour of more extractable competitors.";
    "geo-no-author" => "GEO: Missing Authorship / E-E-A-T", Geo, Notice,
        "Generative and traditional engines weigh experience, expertise, authoritativeness, and trust. Clear authorship and dates are strong trust signals.",
        "Add a named author with credentials, a published/modified date, and author schema markup.",
        "Reduced trust weighting and citation likelihood.";
    "geo-thin-for-ai" => "GEO: Too Thin to Cite", Geo, Notice,
        "AI engines cite substantive, self-contained passages. Very short pages rarely contain a citable, authoritative chunk.",
        "Add depth: definitions, specifics, data, and self-contained explanations an engine can lift verbatim.",
        "Little to quote means little chance of being referenced.";
    "geo-no-semantic-html" => "GEO: Weak Semantic Structure", Geo, Notice,
        "Landmarks like <main>, <article>, and a clean heading outline help machines isolate the main content from navigation and boilerplate.",
        "Wrap primary content in <main>/<article>, and use a logical H1→H2→H3 outline.",
        "Harder for engines to separate content from chrome, lowering extraction quality.";
    "geo-ready" => "GEO: AI-Ready Page", Geo, Good,
        "This page has the structure, semantics, and signals generative engines prefer — it's well positioned to be cited in AI answers.",
        "Maintain this: keep structured data current, answers near the top, and authorship clear.",
        "Strong candidate for inclusion in AI-generated answers.";
}

/// Look up educational guidance for a rule. Returns `None` for unknown rules.
pub fn rule_info(rule: &str) -> Option<RuleInfo> {
    ENTRIES.iter().find(|e| e.rule == rule).map(to_info)
}

/// Every documented rule, for browsing/exporting the knowledge base.
pub fn all_rules() -> Vec<RuleInfo> {
    ENTRIES.iter().map(to_info).collect()
}

fn to_info(e: &Entry) -> RuleInfo {
    RuleInfo {
        rule: e.rule.to_string(),
        title: e.title.to_string(),
        category: e.category,
        severity: e.severity,
        why: e.why.to_string(),
        how_to_fix: e.how.to_string(),
        impact: e.impact.to_string(),
    }
}
