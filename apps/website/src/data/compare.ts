// Data for the /compare/[slug] pages. Honest, answer-first comparisons — the
// "where they still win" sections are deliberate: balanced, sourced content is
// both more trustworthy and more citable by AI search (GEO).

export interface CompareRow {
  feature: string;
  crawlie: string;
  them: string;
  /** Which side this row favours — drives the cell colour. */
  win: "crawlie" | "them" | "tie";
}

export interface QA {
  q: string;
  a: string;
}

export interface Competitor {
  slug: string;
  /** Short name, e.g. "Screaming Frog". */
  name: string;
  /** Full product name, e.g. "Screaming Frog SEO Spider". */
  product: string;
  title: string;
  description: string;
  tagline: string;
  /** Answer-first TL;DR (the citable summary). */
  answer: string;
  rows: CompareRow[];
  /** "Why teams choose crawlie" — question headings, answer-first bodies. */
  reasons: { h: string; p: string }[];
  /** Honest "where they still win". */
  strengths: string[];
  faq: QA[];
  /** ISO date, surfaced for E-E-A-T / GEO dated-content signals. */
  updated: string;
}

const UPDATED = "2026-06-26";

export const COMPETITORS: Competitor[] = [
  {
    slug: "screaming-frog",
    name: "Screaming Frog",
    product: "Screaming Frog SEO Spider",
    title: "crawlie vs Screaming Frog — free, open-source SEO crawler alternative",
    description:
      "How crawlie compares to the Screaming Frog SEO Spider: free and open-source, no 500-URL cap, a scriptable CLI and an MCP server for AI agents, and AI-search (GEO) checks — plus an honest look at where Screaming Frog still wins.",
    tagline: "A free, open-source, agent-native alternative to the Screaming Frog SEO Spider.",
    answer:
      "crawlie is a free, open-source technical-SEO and GEO crawler. Against Screaming Frog it drops the 500-URL free cap and the paid licence, adds a scriptable CLI and an MCP server so AI agents can run full audits, and grades AI-search (GEO) readiness. crawlie now also renders JavaScript with headless Chrome, so it audits client-rendered (SPA) sites too. Screaming Frog is still ahead on built-in Google Search Console, Analytics, and PageSpeed integrations.",
    rows: [
      { feature: "Price", crawlie: "Free & open-source (MIT)", them: "Free to 500 URLs, then £259/yr", win: "crawlie" },
      { feature: "Crawl limit (free)", crawlie: "Unlimited", them: "500 URLs", win: "crawlie" },
      { feature: "Open source", crawlie: "Yes — read & extend it", them: "No (closed source)", win: "crawlie" },
      { feature: "CLI with JSON output", crawlie: "Yes", them: "Partial", win: "crawlie" },
      { feature: "MCP server (agent-native)", crawlie: "Yes", them: "No", win: "crawlie" },
      { feature: "AI-search (GEO) audit", crawlie: "Yes", them: "No", win: "crawlie" },
      { feature: "Structured-data validation", crawlie: "Yes", them: "Yes", win: "tie" },
      { feature: "Crawl-over-crawl diffing", crawlie: "Yes (crawlie diff)", them: "Limited", win: "crawlie" },
      { feature: "Plain-English fix for every issue", crawlie: "Yes", them: "No", win: "crawlie" },
      { feature: "Large-site crawls", crawlie: "Streams to SQLite", them: "Database storage mode", win: "tie" },
      { feature: "Custom extraction", crawlie: "CSS + regex", them: "CSS, XPath, regex", win: "tie" },
      { feature: "JavaScript rendering", crawlie: "Yes (headless Chrome)", them: "Yes", win: "tie" },
      { feature: "GSC / Analytics / PageSpeed", crawlie: "Not yet", them: "Yes", win: "them" },
      { feature: "Engine", crawlie: "Rust (tiny binary)", them: "Java (JVM)", win: "tie" },
    ],
    reasons: [
      {
        h: "Is crawlie a good Screaming Frog alternative?",
        p: "Yes — especially if you want something free, scriptable, and agent-friendly. crawlie runs the same core technical-SEO checks (broken links, redirects, titles & meta, canonicals, indexability, structured data) with no URL cap and no licence, and adds things Screaming Frog doesn't have. crawlie now renders JavaScript too (the `--render` flag drives headless Chrome), so the main remaining trade-off is Screaming Frog's built-in Google Search Console, Analytics, and PageSpeed integrations.",
      },
      {
        h: "What does crawlie do that Screaming Frog doesn't?",
        p: "Three things. It's agent-native — an MCP server and Claude Skills let an AI agent run a full audit and read the results. It grades GEO (Generative Engine Optimization): how citable your pages are by ChatGPT, Perplexity, and Google AI Overviews. And every finding ships with a plain-English explanation of why it matters and how to fix it. It's also open source, so you can read exactly what it checks and extend it.",
      },
      {
        h: "Is crawlie really free, with no URL limit?",
        p: "Yes. crawlie is MIT-licensed and free for any number of URLs. Screaming Frog is free up to 500 URLs per crawl; beyond that it needs a paid annual licence. For sites larger than 500 pages, crawlie removes that wall entirely.",
      },
    ],
    strengths: [
      "Built-in integrations — it pulls Google Search Console, Analytics, and PageSpeed/Lighthouse data into the crawl. crawlie doesn't connect those yet.",
      "XPath custom extraction — crawlie now does CSS-selector and regex extraction, but Screaming Frog also supports XPath.",
      "A mature, refined desktop app on Windows, macOS, and Linux with years of polish.",
    ],
    faq: [
      { q: "Is crawlie free?", a: "Yes — crawlie is free and open-source under the MIT licence, with no URL cap." },
      { q: "Does crawlie render JavaScript like Screaming Frog?", a: "Yes. With the `--render` flag, crawlie loads each page in headless Chrome and audits the rendered DOM — so it sees client-rendered (SPA) content, the same as Screaming Frog. It also flags pages whose content only appears after JavaScript runs (the `content-requires-js` check)." },
      { q: "Can I run crawlie in CI?", a: "Yes. The CLI outputs clean JSON and sets exit codes (`--fail-on`), so you can gate a build on SEO regressions. There's a ready-to-paste GitHub Actions workflow in the docs." },
      { q: "Can AI agents use crawlie?", a: "Yes. crawlie ships an MCP server and Claude Skills, so an agent can crawl a site, read structured findings, and explain fixes — something Screaming Frog can't do." },
      { q: "Does crawlie have a free URL limit?", a: "No. crawlie crawls any number of URLs for free. Screaming Frog's free tier stops at 500 URLs per crawl." },
    ],
    updated: UPDATED,
  },
  {
    slug: "sitebulb",
    name: "Sitebulb",
    product: "Sitebulb",
    title: "crawlie vs Sitebulb — free, open-source SEO crawler alternative",
    description:
      "How crawlie compares to Sitebulb: free and open-source, a scriptable CLI and an MCP server for AI agents, AI-search (GEO) checks, and crawl-over-crawl diffing — plus an honest look at where Sitebulb still wins.",
    tagline: "A free, open-source, agent-native alternative to Sitebulb.",
    answer:
      "crawlie is a free, open-source technical-SEO and GEO crawler. Against Sitebulb it matches the crawl-over-crawl comparison and the plain-English guidance, adds a scriptable CLI, an MCP server for AI agents, and AI-search (GEO) grading — all for free, with no subscription. crawlie now also renders JavaScript with headless Chrome, so it audits client-rendered sites too. Sitebulb is still ahead on data integrations and its visual crawl maps and reporting depth.",
    rows: [
      { feature: "Price", crawlie: "Free & open-source (MIT)", them: "Paid subscription, from £13.50/mo", win: "crawlie" },
      { feature: "Open source", crawlie: "Yes — read & extend it", them: "No (closed source)", win: "crawlie" },
      { feature: "CLI with JSON output", crawlie: "Yes", them: "No", win: "crawlie" },
      { feature: "MCP server (agent-native)", crawlie: "Yes", them: "No", win: "crawlie" },
      { feature: "AI-search (GEO) audit", crawlie: "Yes", them: "No", win: "crawlie" },
      { feature: "Crawl-over-crawl diffing", crawlie: "Yes (crawlie diff)", them: "Yes", win: "tie" },
      { feature: "Plain-English guidance", crawlie: "Every issue", them: "Yes (Hints)", win: "tie" },
      { feature: "Structured-data validation", crawlie: "Yes", them: "Yes", win: "tie" },
      { feature: "Custom extraction", crawlie: "CSS + regex", them: "Yes", win: "tie" },
      { feature: "Visual crawl maps", crawlie: "No", them: "Yes", win: "them" },
      { feature: "JavaScript rendering", crawlie: "Yes (headless Chrome)", them: "Yes", win: "tie" },
      { feature: "GSC / Analytics integrations", crawlie: "Not yet", them: "Yes", win: "them" },
      { feature: "Engine", crawlie: "Rust (tiny binary)", them: ".NET", win: "tie" },
    ],
    reasons: [
      {
        h: "Is crawlie a good Sitebulb alternative?",
        p: "Yes, if you want Sitebulb's strengths — crawl comparisons and clear, prioritized guidance — without the subscription, plus a CLI and agent support. crawlie is free and open-source, runs the core technical-SEO and structured-data checks, renders JavaScript with headless Chrome, and explains every finding. Sitebulb still leads on visual crawl maps and reporting depth.",
      },
      {
        h: "What does crawlie offer that Sitebulb doesn't?",
        p: "It's free and open-source, so there's no subscription and you can read or extend the engine. It has a scriptable CLI for CI and an MCP server so AI agents can run audits. And it grades GEO — how citable your content is to AI search engines like ChatGPT and Perplexity — which Sitebulb doesn't measure.",
      },
      {
        h: "Does crawlie compare crawls the way Sitebulb does?",
        p: "Yes. `crawlie diff` (and a Compare view in the desktop app) shows exactly what changed between two crawls: health and GEO score deltas, pages added and removed, and issues that were resolved or newly appeared — so you can verify a fix landed or catch a regression.",
      },
    ],
    strengths: [
      "Visual crawl maps and force-directed link graphs — Sitebulb's signature, great for seeing site architecture at a glance. crawlie reports the data but doesn't visualise it this way.",
      "Built-in Google Search Console and Analytics integrations layered onto the crawl.",
      "A deep, well-curated Hint library that explains issues in detail.",
    ],
    faq: [
      { q: "Is crawlie free?", a: "Yes — crawlie is free and open-source under the MIT licence. Sitebulb is a paid subscription." },
      { q: "Does crawlie compare two crawls like Sitebulb?", a: "Yes. `crawlie diff` and the desktop Compare view show score deltas, pages added/removed, and resolved vs new issues between two crawls." },
      { q: "Does crawlie render JavaScript?", a: "Yes. With the `--render` flag, crawlie loads each page in headless Chrome and audits the rendered DOM, so it sees client-rendered content — the same as Sitebulb. It also flags pages whose content only appears after JavaScript runs (the `content-requires-js` check)." },
      { q: "Can AI agents use crawlie?", a: "Yes. crawlie ships an MCP server and Claude Skills so an agent can run a full SEO audit and read the results." },
      { q: "Does crawlie have the visual crawl maps Sitebulb is known for?", a: "Not currently. crawlie surfaces the same underlying data (depth, inlinks, link authority) in tables and scores, but doesn't render the visual crawl-map diagrams Sitebulb does." },
    ],
    updated: UPDATED,
  },
  {
    slug: "siteimprove",
    name: "Siteimprove",
    product: "Siteimprove Accessibility",
    title: "crawlie vs Siteimprove — free, open-source accessibility & SEO checker alternative",
    description:
      "How crawlie compares to Siteimprove for accessibility: free and open-source, runs locally, gives you a separate WCAG accessibility score inside the same crawl as your SEO and AI-search checks, with a CLI and MCP server for CI and AI agents — plus an honest look at where Siteimprove's enterprise platform still wins.",
    tagline: "A free, open-source, agent-native way to get automated WCAG checks — without an enterprise contract.",
    answer:
      "crawlie is a free, open-source crawler that checks technical SEO, AI-search (GEO) readiness, and accessibility in one pass, and reports a separate WCAG accessibility score. Against Siteimprove it's free instead of a quote-only enterprise contract, runs locally, and is built for developers — a scriptable CLI you can gate CI on and an MCP server so AI agents can run audits. Siteimprove is a much deeper, dedicated accessibility platform: far broader automated WCAG 2.1/2.2 coverage (including colour contrast and ARIA), PDF accessibility, assisted manual review, remediation workflows, compliance reporting and org-wide dashboards. crawlie runs a focused set of static WCAG checks, so it catches the common machine-detectable failures early and free — it isn't a full enterprise compliance programme.",
    rows: [
      { feature: "Price", crawlie: "Free & open-source (MIT)", them: "Enterprise SaaS, quote-only (commonly $15k+/yr)", win: "crawlie" },
      { feature: "Open source", crawlie: "Yes — read & extend it", them: "No (closed source)", win: "crawlie" },
      { feature: "Runs locally / data stays on your machine", crawlie: "Yes (local-first)", them: "Cloud SaaS", win: "crawlie" },
      { feature: "Separate accessibility score", crawlie: "Yes (0–100, kept apart from SEO)", them: "Yes", win: "tie" },
      { feature: "Automated WCAG coverage", crawlie: "Focused static checks", them: "Broad WCAG 2.1 / 2.2", win: "them" },
      { feature: "Colour-contrast & deep ARIA checks", crawlie: "Not yet", them: "Yes", win: "them" },
      { feature: "PDF accessibility", crawlie: "No", them: "Yes", win: "them" },
      { feature: "Assisted manual review & remediation workflow", crawlie: "No", them: "Yes", win: "them" },
      { feature: "Accessibility + SEO + AI-search in one crawl", crawlie: "Yes", them: "Separate paid modules", win: "crawlie" },
      { feature: "CLI + CI gating", crawlie: "Yes (JSON, --fail-on)", them: "API (enterprise tier)", win: "crawlie" },
      { feature: "MCP server (agent-native)", crawlie: "Yes", them: "No", win: "crawlie" },
      { feature: "Plain-English fix for every issue", crawlie: "Yes", them: "Yes (+ AI suggestions)", win: "tie" },
      { feature: "Compliance reporting / VPAT", crawlie: "No", them: "Yes", win: "them" },
      { feature: "Time to first result", crawlie: "Install & run in seconds", them: "Sales call + onboarding", win: "crawlie" },
    ],
    reasons: [
      {
        h: "Is crawlie a Siteimprove alternative?",
        p: "For a full enterprise accessibility programme — org-wide governance, manual audits, VPATs, remediation tracking — no, and crawlie doesn't pretend to be. For a developer or small team that wants automated WCAG checks for free, in the same crawl as their SEO and AI-search audit, and gateable in CI, yes. crawlie catches the common machine-detectable failures (links and buttons with no accessible name, unlabelled form fields, untitled iframes, zoom-blocking viewports, positive tabindex, skipped headings) early and at no cost — the work you'd otherwise wait for a quarterly Siteimprove scan to surface.",
      },
      {
        h: "What does crawlie do that Siteimprove doesn't?",
        p: "It's free and open-source, and it runs locally so nothing about your site leaves your machine. It checks accessibility, technical SEO, and AI-search (GEO) readiness in a single crawl instead of three paid modules. It has a scriptable CLI you can fail a build on and an MCP server so AI agents can run the audit and read the results. And it reports accessibility as its own score, kept deliberately apart from the SEO score so neither hides the other.",
      },
      {
        h: "When should you still choose Siteimprove?",
        p: "When you need depth and coverage crawlie doesn't offer: the full automated WCAG 2.1/2.2 ruleset including colour contrast and detailed ARIA, PDF accessibility, assisted manual review, remediation workflows and goal tracking, compliance reporting and VPATs, and dashboards for a whole organisation. Siteimprove is a dedicated accessibility platform with the breadth and support an enterprise compliance team needs; crawlie is a free, automated first line of defence.",
      },
    ],
    strengths: [
      "Far broader automated WCAG 2.1/2.2 coverage, including colour-contrast and detailed ARIA checks that crawlie's static checks don't attempt.",
      "PDF accessibility scanning and assisted manual review — the parts of conformance that can't be decided from HTML alone.",
      "Remediation workflows, goal tracking, role-based dashboards, and compliance/VPAT reporting built for an enterprise accessibility programme.",
      "Site-wide scheduled monitoring across a whole organisation, with onboarding, training, and support.",
    ],
    faq: [
      { q: "Is crawlie free?", a: "Yes — crawlie is free and open-source under the MIT licence, with no URL cap. Siteimprove is a quote-only enterprise SaaS, commonly priced in the five-to-six figures per year." },
      { q: "Does crawlie replace Siteimprove for accessibility?", a: "Not for a full enterprise compliance programme. crawlie runs a focused set of static WCAG checks for free and in CI; Siteimprove offers far broader automated coverage plus manual review, remediation workflows, and compliance reporting. crawlie is the free, automated first line of defence; Siteimprove is the dedicated platform." },
      { q: "What accessibility checks does crawlie run?", a: "Static, false-positive-resistant WCAG checks decidable from the markup: links and buttons with no accessible name, form controls with no label, iframes with no title, zoom-blocking viewports, positive tabindex, and skipped heading levels — reported as a separate accessibility score alongside Health and GEO." },
      { q: "Does crawlie check colour contrast?", a: "Not yet. Contrast needs rendered styles, so it's outside crawlie's current static checks. Siteimprove does check contrast. crawlie focuses on the structural WCAG failures it can detect reliably from the HTML." },
      { q: "Can I run crawlie's accessibility checks in CI?", a: "Yes. The CLI outputs JSON and sets exit codes (`--fail-on`), and the accessibility score is tracked in saved reports and crawl-over-crawl diffs, so you can gate a build on accessibility regressions — no enterprise contract required." },
    ],
    updated: "2026-06-29",
  },
];
