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

const UPDATED = "2026-06-24";

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
      "crawlie is a free, open-source technical-SEO and GEO crawler. Against Screaming Frog it drops the 500-URL free cap and the paid licence, adds a scriptable CLI and an MCP server so AI agents can run full audits, and grades AI-search (GEO) readiness. Screaming Frog is still ahead on JavaScript rendering and built-in Google Search Console, Analytics, and PageSpeed integrations.",
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
      { feature: "JavaScript rendering", crawlie: "Not yet", them: "Yes", win: "them" },
      { feature: "GSC / Analytics / PageSpeed", crawlie: "Not yet", them: "Yes", win: "them" },
      { feature: "Engine", crawlie: "Rust (tiny binary)", them: "Java (JVM)", win: "tie" },
    ],
    reasons: [
      {
        h: "Is crawlie a good Screaming Frog alternative?",
        p: "Yes — especially if you want something free, scriptable, and agent-friendly. crawlie runs the same core technical-SEO checks (broken links, redirects, titles & meta, canonicals, indexability, structured data) with no URL cap and no licence, and adds things Screaming Frog doesn't have. The main trade-off today is JavaScript rendering, which Screaming Frog does and crawlie doesn't yet.",
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
      "JavaScript rendering — Screaming Frog renders pages in a headless browser, so it audits SPAs and client-rendered content. crawlie currently fetches raw HTML.",
      "Built-in integrations — it pulls Google Search Console, Analytics, and PageSpeed/Lighthouse data into the crawl. crawlie doesn't connect those yet.",
      "Custom extraction — XPath/CSS/regex scraping of arbitrary data from pages.",
      "A mature, refined desktop app on Windows, macOS, and Linux with years of polish.",
    ],
    faq: [
      { q: "Is crawlie free?", a: "Yes — crawlie is free and open-source under the MIT licence, with no URL cap." },
      { q: "Does crawlie render JavaScript like Screaming Frog?", a: "Not yet. crawlie fetches and parses the raw HTML response. Screaming Frog can render pages in a headless browser, so for heavily client-rendered (SPA) sites it currently sees more." },
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
      "crawlie is a free, open-source technical-SEO and GEO crawler. Against Sitebulb it matches the crawl-over-crawl comparison and the plain-English guidance, adds a scriptable CLI, an MCP server for AI agents, and AI-search (GEO) grading — all for free, with no subscription. Sitebulb is still ahead on JavaScript rendering, data integrations, and its visual crawl maps and reporting depth.",
    rows: [
      { feature: "Price", crawlie: "Free & open-source (MIT)", them: "Paid subscription, from £13.50/mo", win: "crawlie" },
      { feature: "Open source", crawlie: "Yes — read & extend it", them: "No (closed source)", win: "crawlie" },
      { feature: "CLI with JSON output", crawlie: "Yes", them: "No", win: "crawlie" },
      { feature: "MCP server (agent-native)", crawlie: "Yes", them: "No", win: "crawlie" },
      { feature: "AI-search (GEO) audit", crawlie: "Yes", them: "No", win: "crawlie" },
      { feature: "Crawl-over-crawl diffing", crawlie: "Yes (crawlie diff)", them: "Yes", win: "tie" },
      { feature: "Plain-English guidance", crawlie: "Every issue", them: "Yes (Hints)", win: "tie" },
      { feature: "Structured-data validation", crawlie: "Yes", them: "Yes", win: "tie" },
      { feature: "Visual crawl maps", crawlie: "No", them: "Yes", win: "them" },
      { feature: "JavaScript rendering", crawlie: "Not yet", them: "Yes", win: "them" },
      { feature: "GSC / Analytics integrations", crawlie: "Not yet", them: "Yes", win: "them" },
      { feature: "Engine", crawlie: "Rust (tiny binary)", them: ".NET", win: "tie" },
    ],
    reasons: [
      {
        h: "Is crawlie a good Sitebulb alternative?",
        p: "Yes, if you want Sitebulb's strengths — crawl comparisons and clear, prioritized guidance — without the subscription, plus a CLI and agent support. crawlie is free and open-source, runs the core technical-SEO and structured-data checks, and explains every finding. Sitebulb still leads on visual reporting and JavaScript rendering.",
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
      "JavaScript rendering of client-side content. crawlie fetches raw HTML today.",
      "Built-in Google Search Console and Analytics integrations layered onto the crawl.",
      "A polished, mature desktop experience with a deep, well-curated Hint library.",
    ],
    faq: [
      { q: "Is crawlie free?", a: "Yes — crawlie is free and open-source under the MIT licence. Sitebulb is a paid subscription." },
      { q: "Does crawlie compare two crawls like Sitebulb?", a: "Yes. `crawlie diff` and the desktop Compare view show score deltas, pages added/removed, and resolved vs new issues between two crawls." },
      { q: "Does crawlie render JavaScript?", a: "Not yet — it parses the raw HTML response. Sitebulb can render JavaScript, so it currently sees more on heavily client-rendered sites." },
      { q: "Can AI agents use crawlie?", a: "Yes. crawlie ships an MCP server and Claude Skills so an agent can run a full SEO audit and read the results." },
      { q: "Does crawlie have the visual crawl maps Sitebulb is known for?", a: "Not currently. crawlie surfaces the same underlying data (depth, inlinks, link authority) in tables and scores, but doesn't render the visual crawl-map diagrams Sitebulb does." },
    ],
    updated: UPDATED,
  },
];
