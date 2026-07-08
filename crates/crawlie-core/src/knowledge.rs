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
    "redirect-loop" => "Redirect Loop", Response, Error,
        "This URL's redirects revisit a URL already in the chain, so the request never resolves. Browsers give up with an error and search engines drop the URL entirely.",
        "Trace the redirect rules (server config, CDN, CMS plugins) and break the cycle so the URL resolves to a final 200 destination in one hop.",
        "The page is completely unreachable for users and search engines.";
    "redirect-temporary" => "Temporary Redirect", Response, Notice,
        "A 302/307 tells search engines the move is temporary, so they keep the old URL indexed and don't pass full signals to the destination. Most 'temporary' redirects are actually permanent moves.",
        "If the move is permanent, switch to a 301 (or 308) so engines transfer indexing and link signals to the destination.",
        "Link equity and indexing stay split between the old and new URLs.";
    "meta-refresh" => "Meta Refresh Redirect", Response, Warning,
        "A <meta http-equiv=\"refresh\"> redirect is slower than an HTTP redirect, passes signals unreliably, and is flagged by accessibility guidelines because the page changes without user action.",
        "Replace the meta refresh with a server-side 301/302 redirect to the destination URL.",
        "Slow, unreliable redirects that confuse users and dilute SEO signals.";

    // ---- Links ----
    "broken-link" => "Broken Link", Links, Error,
        "A link on this page points to a URL that returns an error. Broken links erode trust, waste crawl budget, and send users and bots to dead ends.",
        "Fix the link target, update it to the correct URL, or remove the link. Re-check periodically as external targets change.",
        "Poor user experience and leaked link equity into broken destinations.";
    "orphan" => "Orphan Page", Links, Notice,
        "No internal links point to this page, so users and crawlers can only reach it via the sitemap or external links. Orphans get crawled rarely and rank poorly.",
        "Add internal links to the page from relevant, in-context locations (navigation, related content, hub pages).",
        "Reduced discoverability, crawl frequency, and ranking potential.";
    "dead-end" => "Dead End", Links, Notice,
        "This page links out to no other internal pages, so it's a dead end: visitors and crawlers that arrive have nowhere to go next, and the page passes none of its authority (PageRank) on to the rest of the site.",
        "Add relevant, in-context internal links to related content, hub pages, or logical next steps so authority and visitors flow onward.",
        "Trapped crawl paths, wasted link equity, and dead-end user journeys.";
    "deep-page" => "Deep Page", Links, Notice,
        "This page is many clicks from the homepage. Pages buried deep in the architecture receive less crawl attention and less internal link equity.",
        "Flatten your site architecture so important pages sit within ~3 clicks of the homepage via hub pages and contextual links.",
        "Slower indexing and weaker rankings for deep content.";
    "too-many-links" => "Excessive Outlinks", Links, Notice,
        "Hundreds of links on one page split its link equity into tiny fractions and overwhelm both users and crawlers. Mega-menus and unbounded tag clouds are the usual culprits.",
        "Trim navigation and footer link blocks to what users actually need, and paginate or curate long link lists.",
        "Diluted link equity and a weaker crawl signal for every linked page.";
    "nofollow-internal-links" => "Nofollow Internal Links", Links, Notice,
        "rel=\"nofollow\" on internal links tells search engines not to pass signals through them — almost never what you want inside your own site, and it can strand the target pages.",
        "Remove nofollow from internal links. Use noindex on the target page instead if you don't want it indexed.",
        "Wasted link equity and weaker crawl paths within your own site.";
    "generic-anchor-text" => "Non-Descriptive Anchor Text", Links, Notice,
        "Anchors like 'click here' or 'read more' tell search engines (and screen-reader users navigating by links) nothing about the destination. Descriptive anchors are a genuine relevance signal.",
        "Rewrite anchors to describe the destination ('see our pricing' instead of 'click here').",
        "Lost relevance signals and harder navigation for assistive tech.";

    // ---- URLs ----
    "url-uppercase" => "Uppercase Characters in URL", Category::Url, Notice,
        "URLs are case-sensitive, so /Page and /page are different URLs to search engines. Mixed case invites duplicate-content splits and broken links from case-typos.",
        "Standardise on lowercase URLs and 301-redirect uppercase variants to the lowercase form.",
        "Duplicate URL variants competing against each other.";
    "url-underscores" => "Underscores in URL", Category::Url, Notice,
        "Google treats underscores as word joiners, not separators — /blue_widgets reads as 'bluewidgets'. Hyphens are the recognised word separator.",
        "Use hyphens to separate words in new URLs. Existing URLs are usually not worth redirecting for this alone.",
        "Slightly weaker keyword recognition in URL paths.";
    "url-space" => "Whitespace in URL", Category::Url, Warning,
        "Spaces in URLs must be encoded (%20) and frequently break when copied, shared, or linked — a common source of 404s.",
        "Replace spaces with hyphens in URL slugs and redirect the old URLs.",
        "Fragile links that break in emails, chats, and markup.";
    "url-double-slash" => "Multiple Slashes in URL", Category::Url, Warning,
        "Doubled slashes (site.com/blog//post) usually come from sloppy link concatenation and create duplicate URL variants of the same page.",
        "Fix the link-building logic or template producing the doubled slash, and 301 the variants to the clean URL.",
        "Duplicate URLs and wasted crawl budget.";
    "url-non-ascii" => "Non-ASCII Characters in URL", Category::Url, Notice,
        "Non-ASCII characters get percent-encoded inconsistently by different tools, creating multiple byte-level variants of the same URL and unreadable encoded strings when shared.",
        "Prefer ASCII slugs (transliterate where sensible), and be consistent about encoding if international URLs are a deliberate choice.",
        "Encoding-variant duplicates and ugly shared links.";
    "url-too-long" => "URL Over 115 Characters", Category::Url, Notice,
        "Very long URLs are harder to share, get truncated in SERPs and social shares, and usually signal parameter bloat or over-nested paths.",
        "Keep slugs short and descriptive; flatten unnecessary path levels and drop redundant parameters.",
        "Reduced shareability and messier search snippets.";
    "url-parameters" => "Multiple URL Parameters", Category::Url, Notice,
        "URLs carrying several query parameters usually mean faceted navigation or session state — the classic source of infinite URL spaces that burn crawl budget.",
        "Keep indexable content on clean paths, canonicalise parameterised variants, and block crawl-trap parameters in robots.txt.",
        "Crawl budget wasted on near-duplicate parameter permutations.";
    "url-tracking-params" => "Tracking Parameters in URL", Category::Url, Notice,
        "Internal links carrying utm_/gclid-style parameters create duplicate URLs and pollute your analytics (internal clicks masquerade as campaign traffic).",
        "Never use UTM parameters on internal links. Canonicalise or redirect tracked URLs to the clean version.",
        "Duplicate indexed URLs and corrupted campaign analytics.";
    "url-internal-search" => "Internal Search URL Crawled", Category::Url, Notice,
        "Internal search-result URLs (?s=, ?q=, ?search=) form an infinite URL space: every query is a new page of templated results. Crawled and indexed search pages waste crawl budget and are classic thin content.",
        "Disallow the search path/parameter in robots.txt and noindex search result pages.",
        "Crawl budget burned on unbounded, low-value result pages.";
    "amp-broken" => "Broken AMP URL", Indexability, Warning,
        "The page declares a rel=amphtml alternate that returns an error, so the AMP version can't be served and the annotation misleads crawlers.",
        "Fix the AMP page or remove the amphtml link if AMP has been retired.",
        "No AMP serving and wasted crawler fetches on a dead alternate.";
    "amp-redirect" => "Redirecting AMP URL", Indexability, Notice,
        "The declared AMP alternate redirects. AMP annotations should point directly at the final AMP document.",
        "Update the amphtml href to the final URL.",
        "Extra hops on every AMP discovery fetch.";
    "url-repetitive-path" => "Repetitive Path Segments", Category::Url, Warning,
        "The same path segment repeats several times (/page/page/page) — the signature of a relative-link bug generating an infinite URL space crawlers can fall into.",
        "Find the template emitting relative links without a trailing-slash-aware base and switch to absolute or root-relative URLs.",
        "A crawl trap that can consume your entire crawl budget.";
    "url-case-duplicate" => "Duplicate URL (Case Variant)", Category::Url, Warning,
        "This URL was crawled in more than one letter-case variant, and each variant is a separate URL to search engines — the same content competing with itself.",
        "301-redirect all case variants to one canonical casing (lowercase by convention) at the server level.",
        "Split ranking signals across identical pages.";
    "url-slash-duplicate" => "Duplicate URL (Trailing Slash)", Category::Url, Warning,
        "Both the trailing-slash and non-slash version of this URL respond with content, creating two indexable copies of the same page.",
        "Pick one form and 301-redirect the other site-wide (most servers have a single setting for this).",
        "Duplicate content and divided link equity.";

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
    "title-multiple" => "Multiple Title Tags", TitlesMeta, Warning,
        "More than one <title> element leaves search engines to pick which to display — often not the one you intended. Usually caused by templates or plugins injecting a second title.",
        "Remove all but one <title> in the <head>. Check themes, SEO plugins, and injected widgets for the duplicate.",
        "Unpredictable titles in search results.";
    "description-multiple" => "Multiple Meta Descriptions", TitlesMeta, Notice,
        "Several meta description tags compete; engines pick one arbitrarily, and CMS/plugin duplicates often disagree with each other.",
        "Keep a single meta description per page and remove duplicates injected by plugins or templates.",
        "The wrong snippet may show in search results.";
    "charset-missing" => "Missing Character Encoding", Content, Notice,
        "Without a declared charset, browsers guess the encoding — special characters can render as mojibake, and HTML validators flag the page.",
        "Add <meta charset=\"utf-8\"> as the first element inside <head>.",
        "Garbled text for some users and content misinterpretation risks.";
    "favicon-missing" => "Missing Favicon", Social, Notice,
        "The favicon appears in browser tabs, bookmarks, and next to your result in Google's mobile SERPs. Without one you get a generic placeholder — a small but real branding and trust signal.",
        "Add a <link rel=\"icon\"> in the <head> (ideally multiple sizes plus an apple-touch-icon).",
        "A generic globe icon where your brand should be, including in search results.";
    "soft-404" => "Possible Soft 404", Content, Warning,
        "The page returns 200 but its title or heading says 'not found' — a soft 404. Search engines index these empty error pages, wasting crawl budget and polluting your indexed set.",
        "Return a real 404/410 status for missing content (or 301 to a replacement page). Never serve error pages with a 200.",
        "Error pages ranking in search and wasted crawl budget.";
    "lorem-ipsum" => "Placeholder Text (Lorem Ipsum)", Content, Warning,
        "The page still contains lorem-ipsum placeholder copy — unfinished content that shipped to production.",
        "Replace the placeholder with real content, or noindex/remove the page until it's ready.",
        "Unfinished pages visible to users and indexed by search engines.";

    // ---- Headings ----
    "h1-missing" => "Missing H1", Headings, Warning,
        "The H1 is the page's main on-page heading; it tells users and engines (and increasingly AI answer engines) what the page is about.",
        "Add exactly one clear, descriptive <h1> that summarises the page's topic.",
        "Weaker topical clarity for search and AI extraction.";
    "h1-multiple" => "Multiple H1", Headings, Notice,
        "Several H1s blur the page's primary topic and weaken the heading hierarchy that crawlers and screen readers rely on.",
        "Keep a single H1 and demote the rest to H2/H3 to form a clean outline.",
        "Diluted topical focus and accessibility issues.";
    "h1-too-long" => "H1 Too Long", Headings, Notice,
        "An H1 past ~70 characters stops being a headline and starts being a paragraph — harder to scan for users and a muddier topical signal for engines.",
        "Tighten the H1 to a crisp statement of the page's topic; move the detail into the intro copy.",
        "Weaker scannability and diluted topical focus.";
    "h1-duplicate" => "Duplicate H1", Headings, Notice,
        "Multiple pages share the same H1, so their primary on-page topic signal is identical — engines struggle to tell which page should rank for that topic.",
        "Give each page a unique H1 describing its specific content, just like titles.",
        "Keyword cannibalisation between pages with the same heading.";
    "h2-missing" => "No H2 Headings", Headings, Notice,
        "A long page with no H2s is a wall of text: harder for users to scan, and harder for search and AI engines to extract sections and answers from.",
        "Break the content into logical sections with descriptive H2 subheadings.",
        "Lower engagement and weaker extraction by search/AI engines.";

    // ---- Indexability ----
    "noindex" => "Noindex", Indexability, Warning,
        "A noindex directive tells search engines to keep this page out of their index. Intentional for thank-you/admin pages — disastrous if applied by mistake.",
        "Confirm the noindex is intended. If the page should rank, remove the noindex from the meta robots tag or X-Robots-Tag header.",
        "The page cannot appear in search results.";
    "nofollow" => "Nofollow", Indexability, Notice,
        "A page-level nofollow stops link equity flowing from this page's links, which can strand the pages it links to.",
        "Remove the blanket nofollow unless you deliberately want to seal off link flow from this page.",
        "Reduced crawl discovery and equity distribution.";
    "robots-none" => "Robots Directive: none", Indexability, Warning,
        "The robots \"none\" directive is shorthand for noindex, nofollow — the page is fully sealed off from search. It's obscure enough that it's often set by accident.",
        "Confirm the page really should be invisible to search. If not, remove the directive.",
        "The page can't be indexed and passes no link signals.";
    "robots-nosnippet" => "Robots Directive: nosnippet", Indexability, Notice,
        "nosnippet stops search engines showing any text snippet (or AI Overview citation) for this page — the listing is just a bare title and URL.",
        "Remove nosnippet unless you have a specific legal/licensing reason to suppress snippets.",
        "Dramatically lower click-through from featureless search listings.";
    "robots-noarchive" => "Robots Directive: noarchive", Indexability, Notice,
        "noarchive prevents cached copies of the page. Harmless for most sites, but worth confirming it's intentional since some SEO plugins set it silently.",
        "Remove the directive unless you deliberately want to block cached copies.",
        "No cached version available to users or crawl-diagnostics tools.";
    "robots-noimageindex" => "Robots Directive: noimageindex", Indexability, Notice,
        "noimageindex keeps this page's images out of image search — a whole discovery channel switched off.",
        "Remove the directive unless the images must stay out of image search.",
        "Zero image-search traffic from this page.";
    "robots-unavailable-after" => "Robots Directive: unavailable_after", Indexability, Warning,
        "An unavailable_after directive tells Google to drop this page from the index after a set date. Stale dates from old campaigns silently de-index evergreen pages.",
        "Check the date. If the page should stay indexed, remove the directive.",
        "The page disappears from search on the specified date.";
    "x-robots-noindex" => "X-Robots-Tag: noindex", Indexability, Warning,
        "A noindex set via HTTP header is easy to overlook because it isn't visible in the HTML, yet it removes the page from search just the same.",
        "Audit your server/CDN config and remove the X-Robots-Tag noindex if the page should be indexable.",
        "Silent de-indexing that's hard to spot.";
    "blocked-by-robots" => "Blocked by robots.txt", Indexability, Warning,
        "robots.txt is preventing crawlers from fetching this URL. Blocked pages can't be crawled, and if linked, may show up in results with no snippet.",
        "If the page should be crawled, remove or narrow the Disallow rule. Use noindex (not robots.txt) to keep a page out of the index.",
        "The page's content is invisible to search engines.";
    "no-robots-txt" => "No robots.txt", Indexability, Notice,
        "The site has no /robots.txt. Crawling still works without one, but you lose the ability to steer crawlers, exclude private or low-value paths, and — most usefully — to declare your sitemap location. Some servers also return a stray HTML page for the missing file, which can confuse crawlers.",
        "Add a /robots.txt at the site root. A minimal file allowing everything and pointing at your sitemap is enough: \"User-agent: *\\nAllow: /\\nSitemap: https://example.com/sitemap.xml\".",
        "No crawl control and search engines aren't told where your sitemap lives.";
    "sitemap-broken" => "Broken URL in Sitemap", Indexability, Error,
        "Your sitemap lists a URL that returns an error. Sitemaps are supposed to be the authoritative list of your live, indexable pages — errors there waste crawl budget and erode Google's trust in the whole file.",
        "Regenerate the sitemap from your live URL set, or remove the dead entries. Most CMSs can rebuild it automatically.",
        "Wasted crawl budget and reduced trust in your sitemap's signals.";
    "sitemap-redirect" => "Redirecting URL in Sitemap", Indexability, Warning,
        "A sitemap URL redirects elsewhere. Search engines want final destination URLs in sitemaps; redirects there add hops and blur which URL is canonical.",
        "List the redirect's final destination URL in the sitemap instead.",
        "Slower crawling and mixed canonical signals.";
    "sitemap-noindex" => "Noindex URL in Sitemap", Indexability, Error,
        "The sitemap tells engines to index this URL while its noindex tag says the opposite. Contradictory signals make engines distrust your sitemap.",
        "Remove noindexed URLs from the sitemap (or remove the noindex if the page should rank).",
        "Conflicting indexing signals and reduced sitemap trust.";
    "sitemap-canonicalized" => "Canonicalised URL in Sitemap", Indexability, Warning,
        "This sitemap URL canonicals to a different page — you're asking engines to index a URL that defers to another. Sitemaps should list canonical URLs only.",
        "Replace the entry with the canonical target URL.",
        "Mixed canonicalisation signals across sitemap and markup.";
    "not-in-sitemap" => "Indexable Page Not in Sitemap", Indexability, Notice,
        "This indexable page isn't listed in your XML sitemap, so engines must find it via links alone — slower discovery and weaker freshness signals, especially for deep pages.",
        "Add the page to the sitemap (or fix the generator that's skipping it).",
        "Slower, less reliable indexing for unlisted pages.";
    "no-sitemap" => "No XML sitemap", Indexability, Warning,
        "No XML sitemap was found — neither declared in robots.txt nor at the conventional /sitemap.xml. Sitemaps give search engines an explicit, complete list of your indexable URLs with last-modified hints, which speeds up discovery of new and deep pages that internal links alone may reach slowly.",
        "Generate an XML sitemap listing your canonical, indexable URLs, publish it at /sitemap.xml, and reference it from robots.txt with a \"Sitemap:\" line. Most frameworks and CMSs can produce one automatically.",
        "Slower and less reliable discovery and indexation, especially for new or deep pages.";

    // ---- Canonicals ----
    "canonical-missing" => "Missing Canonical", Canonical, Notice,
        "Without a canonical tag, search engines guess which URL version is authoritative, risking duplicate-content splits across parameters and variants.",
        "Add a self-referencing <link rel=\"canonical\"> on each page pointing to its preferred URL.",
        "Duplicate-content ambiguity and split ranking signals.";
    "canonicalised" => "Canonicalised", Canonical, Notice,
        "This page's canonical points to a different URL, so engines treat the other URL as the one to index. Fine when deliberate, harmful when accidental.",
        "Verify the canonical target is correct. If this page should rank on its own, point the canonical at itself.",
        "The page may be dropped from the index in favour of the canonical target.";
    "canonical-to-broken" => "Canonical Points to Broken URL", Canonical, Error,
        "The canonical tag points to a URL that returns an error, telling search engines the 'preferred' version of this page doesn't exist. Engines then ignore the canonical or, worse, drop both URLs.",
        "Update the canonical to a live, 200-status URL — usually the page itself — and fix or remove the broken target.",
        "Indexing signals are sent into a dead end; the page may fall out of the index.";
    "canonical-to-redirect" => "Canonical Points to Redirect", Canonical, Warning,
        "The canonical target itself redirects, forcing engines to chase a chain to find the real preferred URL. Signals get diluted and engines may ignore the annotation.",
        "Point the canonical directly at the final destination URL (200 status, no hops).",
        "Weakened canonical signals and wasted crawl budget.";
    "canonical-cross-host" => "Canonical Points to Another Host", Canonical, Notice,
        "This page declares a canonical on a different host, handing its indexing rights to another domain or subdomain. Legitimate for syndicated content — costly when accidental (e.g. staging → production mixups, www/apex confusion).",
        "Confirm the cross-domain canonical is intentional. If not, point the canonical at this page's own host.",
        "The page cedes its search presence to the other host.";
    "canonical-conflict" => "Conflicting Canonical Tags", Canonical, Error,
        "Multiple canonical tags point at different URLs. Faced with contradictory instructions, search engines ignore all of them — the page loses canonical control entirely.",
        "Remove the extra canonicals (usually one from the CMS and one from an SEO plugin) so exactly one remains.",
        "All canonical signals are discarded; engines choose the indexed URL themselves.";
    "canonical-multiple" => "Multiple Canonical Tags", Canonical, Notice,
        "The page declares more than one canonical tag. They currently agree, but duplicated tags drift apart easily and some crawlers only honour the first.",
        "Emit a single canonical tag per page — find which template or plugin adds the duplicate.",
        "Fragile canonical setup one template change away from conflict.";
    "noindex-canonical-conflict" => "Noindex Combined With Canonical", Indexability, Warning,
        "The page is noindexed but also canonicals to another URL — two contradictory instructions. Google explicitly advises against combining them: the noindex can bleed through the canonical and de-index the target.",
        "Pick one signal: use a canonical for consolidation (remove the noindex), or a noindex to exclude the page (remove the canonical).",
        "Unpredictable indexing — the canonical target may get dropped too.";

    // ---- Images ----
    "image-missing-alt" => "Images Missing Alt Text", Images, Warning,
        "Alt text describes images to screen-reader users and to search engines (powering image search). Missing alt hurts accessibility and discoverability.",
        "Add concise, descriptive alt attributes to meaningful images; use empty alt=\"\" for purely decorative ones.",
        "Accessibility failures and lost image-search traffic.";

    "image-too-heavy" => "Images Over 100 KB", Images, Notice,
        "One or more images on this page exceed 100 KB. Heavy images are the most common cause of slow LCP and wasted mobile data.",
        "Compress and resize images to their display size, serve next-gen formats (WebP/AVIF), and lazy-load below-the-fold images.",
        "Slower loads, worse Core Web Vitals, higher bounce on slow connections.";

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
    "near-duplicate" => "Near-Duplicate Content", Content, Warning,
        "This page's text is nearly identical to another page — only boilerplate or a few words differ. Search engines cluster near-duplicates and typically rank just one, and thin variations (templated location/product pages) are a common quality-signal drag.",
        "Consolidate the pages (301 or canonical), or differentiate them with genuinely distinct content that serves a distinct intent.",
        "Only one of the variants ranks, and the duplication drags on site quality signals.";
    "readability-difficult" => "Difficult to Read", Content, Notice,
        "The page scores as difficult on the Flesch reading-ease scale — long sentences and heavy vocabulary. Most web audiences (and featured-snippet extraction) favour clearer writing.",
        "Shorten sentences, prefer common words, and break dense paragraphs into lists and subheadings.",
        "Higher bounce rates and weaker snippet/AI-answer extraction.";
    "readability-very-difficult" => "Very Difficult to Read", Content, Notice,
        "The page scores as very difficult to read — academic-paper territory. Unless your audience expects that register, most visitors will struggle.",
        "Rewrite for clarity: one idea per sentence, concrete words, structural aids like lists and examples.",
        "Content most visitors give up on, and engines struggle to excerpt.";
    "low-text-ratio" => "Low Text-to-HTML Ratio", Content, Notice,
        "A page that is mostly markup with little readable text often signals thin or template-heavy content to search and AI engines.",
        "Increase the proportion of meaningful body text relative to code, and remove bloated markup.",
        "Perceived as low-value, reducing ranking and citation.";
    "render-noindex-raw-only" => "Noindex in Raw HTML Only", Indexability, Error,
        "The raw server HTML says noindex but JavaScript removes it after rendering. Google reads the raw noindex first and skips rendering such pages entirely — the JS 'fix' never runs, and the page stays out of the index.",
        "Remove the noindex from the server-rendered HTML. Indexing directives must be correct in the raw response.",
        "The page is silently excluded from search despite looking indexable in the browser.";
    "render-noindex-js" => "Noindex Injected by JavaScript", Indexability, Warning,
        "JavaScript adds a noindex that isn't in the raw HTML. Whether it's honoured depends on the engine rendering the page — Google will eventually see it, most other crawlers never will.",
        "Move the noindex into the server response so every crawler sees the same directive.",
        "Inconsistent indexing across search engines.";
    "render-canonical-mismatch" => "Canonical Changed by JavaScript", Canonical, Error,
        "The rendered DOM's canonical disagrees with the raw HTML's. Google may pick either; two different canonical claims is the worst version of the signal.",
        "Emit one canonical, server-side, and stop JavaScript from rewriting it.",
        "Unpredictable canonicalisation — the wrong URL may be indexed.";
    "render-canonical-js" => "Canonical Only in Rendered DOM", Canonical, Warning,
        "The canonical tag only exists after JavaScript runs. Crawlers that don't render (most of them, and Google's first pass) see no canonical at all.",
        "Render the canonical tag server-side in the raw HTML head.",
        "Duplicate-content protection that most crawlers never see.";
    "render-title-js" => "Title Only in Rendered DOM", TitlesMeta, Warning,
        "The page title only exists after JavaScript runs — the raw HTML has none. Non-rendering crawlers and social unfurlers see an untitled page.",
        "Server-render the <title> tag; let JavaScript update it only for in-app navigation.",
        "Untitled snippets everywhere JavaScript isn't executed.";
    "render-title-modified" => "Title Modified by JavaScript", TitlesMeta, Notice,
        "JavaScript rewrites the title after load, so rendered and raw disagree. Engines may show either version.",
        "Ship the final title in the server HTML so both versions match.",
        "Inconsistent titles between search engines and social previews.";
    "render-description-js" => "Meta Description Only in Rendered DOM", TitlesMeta, Notice,
        "The meta description is injected by JavaScript, so non-rendering crawlers see none.",
        "Server-render the meta description.",
        "Auto-generated snippets on engines that don't render JS.";
    "render-description-modified" => "Meta Description Modified by JavaScript", TitlesMeta, Notice,
        "JavaScript rewrites the meta description after load; raw and rendered disagree.",
        "Ship the final description server-side.",
        "Inconsistent snippets across crawlers.";
    "render-h1-js" => "H1 Only in Rendered DOM", Headings, Notice,
        "The main heading only exists after JavaScript runs — the raw HTML body has no H1.",
        "Server-render the H1 with the primary content.",
        "Non-rendering crawlers see a page without its main heading.";
    "render-h1-modified" => "H1 Modified by JavaScript", Headings, Notice,
        "JavaScript rewrites the H1 after load, so raw and rendered disagree about the page's topic statement.",
        "Ship the final H1 in the server HTML.",
        "Mixed topical signals between rendering and non-rendering crawlers.";
    "render-js-only-links" => "JavaScript-Only Internal Links", Links, Warning,
        "Some internal links only exist after JavaScript runs. Non-rendering crawlers can't discover the pages behind them, and Google's render queue delays discovery.",
        "Render navigation and content links as real <a href> elements in the server HTML.",
        "Slower or missed discovery of everything those links point to.";
    "content-requires-js" => "Content Requires JavaScript", Indexability, Warning,
        "Most of this page's content is missing from the raw HTML and only appears after JavaScript runs. Google renders JS but on a delayed, budget-limited second pass — and most AI answer engines and social/link unfurlers don't execute JS at all, so they see an almost-empty page.",
        "Server-render or pre-render the primary content (SSR/SSG/ISR) so it's present in the initial HTML response. Keep JavaScript for enhancement, not for delivering core content and links.",
        "Delayed or skipped indexing, and invisibility to AI engines and crawlers that don't run JavaScript.";

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
    "https-to-http-link" => "HTTPS Page Links to HTTP", Security, Warning,
        "This secure page contains hyperlinks to plain-HTTP URLs. Every click sends the visitor (or crawler) through an insecure hop and usually a redirect, and internal HTTP links reintroduce the pre-HTTPS URL space.",
        "Update the links to their HTTPS equivalents — internal links first, then external where the target supports HTTPS.",
        "Needless redirects, insecure hops, and mixed signals about your canonical protocol.";
    "form-to-http" => "Form Posts to Insecure URL", Security, Warning,
        "A form on this HTTPS page submits to a plain-HTTP action, sending whatever users type — possibly credentials — unencrypted. Browsers show scary warnings on such forms.",
        "Change the form action to an HTTPS endpoint.",
        "User input transmitted in the clear and browser security warnings.";
    "protocol-relative-links" => "Protocol-Relative Resource Links", Security, Notice,
        "Resources loaded via //host/path inherit the page's protocol — a leftover from the HTTP era. They break when markup is reused in non-HTTP contexts (emails, file://) and mask the intended scheme.",
        "Use explicit https:// URLs for all resources.",
        "Fragile resource loading with no upside on an all-HTTPS web.";
    "no-csp" => "Missing Content-Security-Policy", Security, Notice,
        "Without a CSP header, the browser will execute any script injected into the page — your main defence against XSS is missing.",
        "Add a Content-Security-Policy header, starting with a report-only policy and tightening from there.",
        "No browser-level protection against cross-site scripting.";
    "no-content-type-options" => "Missing X-Content-Type-Options", Security, Notice,
        "Without X-Content-Type-Options: nosniff, browsers may MIME-sniff responses and execute disguised content as script.",
        "Send X-Content-Type-Options: nosniff on every response — it's a one-line server config.",
        "MIME-sniffing attacks against your users become possible.";
    "no-frame-options" => "Missing X-Frame-Options", Security, Notice,
        "Without X-Frame-Options (or CSP frame-ancestors), any site can embed your pages in an iframe and run clickjacking overlays on them.",
        "Send X-Frame-Options: SAMEORIGIN, or the modern equivalent CSP frame-ancestors directive.",
        "Your pages can be framed and clickjacked by malicious sites.";
    "no-referrer-policy" => "Missing Referrer-Policy", Security, Notice,
        "Without a Referrer-Policy, browsers may send full URLs (including query parameters) to every site you link to, leaking paths, tokens, and user data.",
        "Send Referrer-Policy: strict-origin-when-cross-origin (the modern default) or stricter.",
        "URL data leaks to third-party sites in the Referer header.";

    // ---- Performance ----
    "no-compression" => "No Text Compression", Performance, Notice,
        "Serving HTML without gzip/brotli sends far more bytes than necessary, slowing every page load.",
        "Enable gzip or brotli compression for text responses at your server or CDN.",
        "Slower page loads and higher bandwidth use.";

    "lcp-poor" => "Poor LCP", Performance, Warning,
        "Largest Contentful Paint above 4 seconds (lab measurement) — the main content takes far too long to appear. LCP is a Core Web Vital and a confirmed ranking input.",
        "Optimise the LCP element: compress/preload the hero image, cut render-blocking CSS/JS, improve server response time, use a CDN.",
        "A Core Web Vitals failure that hurts rankings and drives users away.";
    "lcp-needs-improvement" => "LCP Needs Improvement", Performance, Notice,
        "Largest Contentful Paint between 2.5 s and 4 s (lab) — short of Google's 'good' threshold.",
        "Preload the LCP resource, trim render-blocking assets, and reduce TTFB to get under 2.5 s.",
        "Missing the 'good' Core Web Vitals bucket costs ranking benefit.";
    "cls-poor" => "Poor CLS", Performance, Warning,
        "Cumulative Layout Shift above 0.25 (lab) — the page visibly jumps as it loads. A Core Web Vital failure and a major annoyance for users.",
        "Reserve space for images/ads/embeds (width/height or aspect-ratio), avoid inserting content above existing content, and preload fonts.",
        "Rage-inducing layout jumps and a failing Core Web Vital.";
    "cls-needs-improvement" => "CLS Needs Improvement", Performance, Notice,
        "Cumulative Layout Shift between 0.1 and 0.25 (lab) — noticeable movement during load.",
        "Add explicit dimensions to media and embeds, and stabilise late-loading UI.",
        "Short of the 'good' Core Web Vitals bucket.";
    "fcp-slow" => "Slow First Contentful Paint", Performance, Notice,
        "First Contentful Paint above 3 seconds (lab) — users stare at a blank screen too long before anything renders.",
        "Reduce render-blocking resources, inline critical CSS, and improve server response time.",
        "High perceived latency and elevated bounce rates.";

    // ---- Mobile ----
    "viewport-missing" => "Missing Viewport", Mobile, Warning,
        "The viewport meta tag is required for responsive layouts. Without it, mobile browsers render a zoomed-out desktop page that's unusable on phones.",
        "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> to the <head>.",
        "Broken mobile experience and mobile-first ranking penalties.";
    "viewport-multiple" => "Multiple Viewport Tags", Mobile, Notice,
        "Several viewport meta tags compete and browsers apply the last one — which may not be the one you meant, especially when a plugin injects its own.",
        "Keep exactly one viewport meta tag in the <head>.",
        "Unpredictable mobile rendering.";
    "image-no-dimensions" => "Images Missing Dimensions", Performance, Notice,
        "Images without width/height attributes force the browser to reflow the layout as each one loads — the main cause of Cumulative Layout Shift (a Core Web Vital).",
        "Add explicit width and height attributes (or CSS aspect-ratio) so the browser reserves space before the image loads.",
        "Layout jank and a worse CLS score.";

    // ---- International ----
    "lang-missing" => "Missing Lang Attribute", International, Notice,
        "The html lang attribute tells browsers, screen readers, and search engines what language the page is in.",
        "Set the language on the root element, e.g. <html lang=\"en\">.",
        "Accessibility issues and weaker language targeting.";
    "hreflang-incomplete" => "Incomplete hreflang", International, Notice,
        "hreflang annotations help engines serve the right language/region version. Incomplete or non-reciprocal hreflang confuses targeting.",
        "Ensure every language variant lists all others (including itself) with valid language-region codes and a return link.",
        "Wrong-language pages shown to users in search results.";
    "hreflang-invalid-code" => "Invalid hreflang Code", International, Warning,
        "An hreflang value isn't a valid language(-script)(-region) tag (e.g. 'en-UK' instead of 'en-GB'). Search engines ignore annotations they can't parse — often silently breaking the whole alternate set.",
        "Use ISO 639-1 language codes with optional ISO 15924 script / ISO 3166-1 region subtags (en, en-GB, zh-Hant), or x-default.",
        "The alternate is ignored and the wrong language version gets served.";
    "hreflang-broken" => "hreflang Points to Broken URL", International, Warning,
        "An hreflang alternate on this page points to a URL that returns an error, so engines can't establish the language cluster and may distrust the remaining annotations.",
        "Fix or remove the broken alternate URL and keep hreflang sets in sync with your live URLs.",
        "Broken language targeting for the whole alternate cluster.";
    "hreflang-no-return" => "hreflang Missing Return Link", International, Warning,
        "This page lists an alternate that doesn't list this page back. hreflang only works when both sides confirm the relationship — without the return link, engines ignore the annotation entirely.",
        "Add the reciprocal hreflang annotation on the alternate page so every variant lists every other (including itself).",
        "The whole language cluster's targeting is discarded by search engines.";
    "pagination-broken" => "Broken Pagination URL", Links, Warning,
        "A rel=prev/next pagination link points at a URL that returns an error, breaking the paginated series for crawlers walking it.",
        "Fix or remove the pagination link so the series resolves end to end.",
        "Crawlers abandon the series and deeper paginated content goes undiscovered.";
    "hreflang-no-x-default" => "hreflang Missing x-default", International, Notice,
        "Without an x-default annotation, search engines have no instruction for users whose language matches none of your alternates.",
        "Add an x-default hreflang pointing at your default/global version (often the language-selector or English page).",
        "Unmatched international users get an arbitrary version.";

    // ---- Social ----
    "og-missing" => "Missing Open Graph Tags", Social, Notice,
        "Open Graph tags control how the page looks when shared on social platforms and in chat apps. Without them, shares get an unattractive, generic preview.",
        "Add og:title, og:description, and og:image (plus a Twitter card) to the <head>.",
        "Poor social share previews and lower click-through from social.";
    "twitter-missing" => "Missing Twitter Card", Social, Notice,
        "Twitter/X card tags define the rich preview when your page is shared there.",
        "Add twitter:card (and optionally twitter:title/description/image) meta tags.",
        "Plain-text social previews that earn fewer clicks.";
    "og-incomplete" => "Open Graph Missing Image", Social, Notice,
        "The page declares Open Graph tags but no og:image, so shares render as text-only cards — dramatically less clickable than image previews.",
        "Add an og:image (1200×630 recommended) alongside the existing OG tags.",
        "Text-only share cards that underperform in every feed.";

    // ---- Structured Data ----
    "structured-data-missing" => "No Structured Data", StructuredData, Notice,
        "Schema.org structured data unlocks rich results (stars, FAQs, breadcrumbs) and is increasingly how AI engines understand and cite a page.",
        "Add relevant JSON-LD (Article, Product, FAQPage, BreadcrumbList, Organization) matching the page's content.",
        "No rich results and reduced machine understanding of the page.";
    "structured-data-invalid" => "Invalid Structured Data", StructuredData, Error,
        "A JSON-LD block on this page isn't valid JSON, so search engines and AI engines skip it entirely — the markup might as well not exist. Common causes are trailing commas, unescaped quotes, or template variables that didn't render.",
        "Open the page's JSON-LD and run it through Google's Rich Results Test or a JSON validator. Fix the syntax error (often a stray comma or unquoted key) so every <script type=\"application/ld+json\"> block parses cleanly.",
        "All structured data on the page is ignored — no rich results and no machine understanding.";
    "schema-missing-required" => "Schema Missing Required Field", StructuredData, Warning,
        "This structured-data item is missing a property Google requires for its rich result. Without every required field, the page is ineligible for the enhanced search appearance even though the markup is present.",
        "Add the missing required properties to the JSON-LD for that type (e.g. price and priceCurrency on an Offer, name and image on a Product). Validate with Google's Rich Results Test until it reports no errors.",
        "The rich result won't show, so you lose the enhanced listing and its click-through advantage.";
    "schema-missing-recommended" => "Schema Missing Recommended Field", StructuredData, Notice,
        "This structured-data item omits properties Google recommends. The rich result can still appear, but recommended fields make it richer and more competitive (ratings, dates, images, authorship).",
        "Add the recommended properties where they apply (e.g. aggregateRating and brand on a Product, datePublished and author on an Article) to strengthen the listing.",
        "A thinner rich result that may lose to more complete competitors.";

    // ---- Accessibility (WCAG) ----
    "a11y-link-no-text" => "Links Without Discernible Text", Accessibility, Warning,
        "A link with no text, aria-label, or alt-bearing image has no accessible name, so screen-reader users hear only \"link\" with no idea where it goes. Icon-only and image links are the usual culprits. Search engines also rely on link text to understand the destination.",
        "Give every link a discernible name: visible text, an aria-label, or an <img> with descriptive alt text inside it. For icon links, add aria-label=\"...\" describing the destination.",
        "Keyboard and screen-reader users can't tell where links lead (WCAG 2.4.4 / 4.1.2).";
    "a11y-button-no-text" => "Buttons Without an Accessible Name", Accessibility, Warning,
        "A button with no text content and no aria-label is announced as just \"button\" — assistive-tech users can't tell what it does. Icon-only buttons (hamburger menus, close \"×\", search) are the common offenders.",
        "Add visible text, an aria-label, or a labelled image to each button. For <input type=\"submit\">, set a meaningful value attribute.",
        "Controls become unusable for screen-reader and voice users (WCAG 4.1.2).";
    "a11y-input-no-label" => "Form Controls Without a Label", Accessibility, Warning,
        "A form field with no associated label leaves assistive-tech users guessing what to enter. A placeholder is not a label — it vanishes on input and is often skipped by screen readers. Unlabeled fields also break voice control and autofill.",
        "Associate every input/select/textarea with a <label for=\"id\">, wrap it in a <label>, or add an aria-label/aria-labelledby. Don't rely on placeholder text alone.",
        "Forms become hard or impossible to complete with assistive tech (WCAG 1.3.1 / 3.3.2).";
    "a11y-zoom-disabled" => "Viewport Disables Zoom", Accessibility, Warning,
        "The viewport meta tag uses user-scalable=no or a maximum-scale below 2, which stops users from pinch-zooming. Low-vision users depend on zoom to read; blocking it is a common, easily-fixed accessibility failure.",
        "Remove user-scalable=no and any maximum-scale below 2 from the viewport meta. Use content=\"width=device-width, initial-scale=1\" and let users zoom.",
        "Low-vision users can't enlarge the page to read it (WCAG 1.4.4).";
    "a11y-iframe-no-title" => "Iframes Missing a Title", Accessibility, Notice,
        "An <iframe> with no title attribute has no accessible name, so screen-reader users hear an unlabeled frame and can't tell what it contains (a video, a map, an ad).",
        "Add a concise title attribute to every iframe describing its content, e.g. title=\"YouTube video: product demo\".",
        "Embedded content is unidentifiable to screen-reader users (WCAG 4.1.2).";
    "a11y-positive-tabindex" => "Positive tabindex", Accessibility, Notice,
        "A tabindex greater than 0 forces an element to the front of the keyboard tab order, overriding the natural DOM order. This almost always produces a confusing, unpredictable focus sequence that's hard to maintain.",
        "Remove positive tabindex values. Use tabindex=\"0\" to make a custom element focusable in DOM order, or restructure the markup so the natural order is correct.",
        "Keyboard focus jumps around unpredictably, disorienting keyboard users (WCAG 2.4.3).";
    "a11y-skipped-heading" => "Skipped Heading Level", Accessibility, Notice,
        "Heading levels jump down by more than one (e.g. an h2 followed by an h4), breaking the document outline screen-reader users navigate by. Headings should describe structure, not be chosen for their visual size.",
        "Use heading levels in order without skipping (h1 → h2 → h3). Style headings with CSS if you need a different visual size, rather than picking a level for its appearance.",
        "The page outline is broken, making heading navigation confusing (WCAG 1.3.1).";

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
    "geo-no-llms-txt" => "GEO: No llms.txt", Geo, Notice,
        "An /llms.txt file is an emerging standard that tells AI engines which content matters most and how to use it — the robots.txt of the generative-search era. Sites that publish one make it easier for assistants to find and cite the right pages.",
        "Add an /llms.txt at your site root: a short Markdown file listing your key pages and a one-line description of the site, with links to the most important content (and optionally full-text .md versions).",
        "AI engines have to guess your most important content instead of being told.";
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
