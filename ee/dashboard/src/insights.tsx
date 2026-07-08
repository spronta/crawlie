// Sitebulb-style audit breakdowns for the cloud report — computed from the
// per-page data the engine already captures. A comprehensive breakdowns grid
// (indexability, canonicals, structured data, content, status, speed, depth,
// security, social, images, mobile, international). Segmented bars, no deps.

interface Pg {
  url: string;
  finalUrl?: string;
  status: number;
  indexable?: boolean;
  indexability?: string | null;
  canonical?: string | null;
  canonicalized?: boolean;
  schemaTypes?: string[];
  invalidJsonld?: number;
  duplicateOf?: string | null;
  responseTimeMs?: number;
  wordCount?: number;
  depth?: number;
  hasViewport?: boolean;
  hsts?: boolean;
  mixedContent?: number;
  ogTitle?: string | null;
  twitterCard?: string | null;
  imagesTotal?: number;
  imagesMissingAlt?: number;
  hreflang?: unknown[];
  contentType?: string | null;
}

type Seg = { label: string; count: number; color: string };
const GREEN = "var(--green, #3ddc91)";
const AMBER = "var(--amber, #f5b544)";
const RED = "var(--red, #ff6166)";
const BLUE = "var(--blue, #0055ee)";
const GREY = "var(--muted-2, #888)";

export function Insights({ pages }: { pages: unknown }) {
  const ps = (pages as Pg[] | undefined) ?? [];
  if (ps.length === 0) return null;
  const html = ps.filter((p) => p.status === 200);
  const n = ps.length;

  const cards: Array<{ title: string; total: number; bars: Seg[] }> = [];

  // Indexability
  const noindex = html.filter((p) => (p.indexability ?? "").toLowerCase().includes("noindex") || p.indexable === false).length;
  const canonicalized = html.filter((p) => p.canonicalized).length;
  cards.push({ title: "Indexability", total: n, bars: [
    { label: "Indexable", count: Math.max(0, html.length - noindex - canonicalized), color: GREEN },
    { label: "Canonicalized", count: canonicalized, color: AMBER },
    { label: "Noindex", count: noindex, color: RED },
    { label: "Non-200", count: n - html.length, color: GREY },
  ]});

  // Canonicals
  cards.push({ title: "Canonical tags", total: html.length, bars: [
    { label: "Self-referencing", count: html.filter((p) => p.canonical && p.canonical === p.url).length, color: GREEN },
    { label: "To another URL", count: html.filter((p) => p.canonical && p.canonical !== p.url).length, color: AMBER },
    { label: "Missing", count: html.filter((p) => !p.canonical).length, color: RED },
  ]});

  // Structured data
  const withSchema = html.filter((p) => (p.schemaTypes ?? []).length > 0).length;
  const invalid = html.filter((p) => (p.invalidJsonld ?? 0) > 0).length;
  cards.push({ title: "Structured data", total: html.length, bars: [
    { label: "Valid", count: withSchema - invalid, color: GREEN },
    { label: "Invalid JSON-LD", count: invalid, color: RED },
    { label: "None", count: html.length - withSchema, color: GREY },
  ]});

  // Content
  const dupes = ps.filter((p) => p.duplicateOf).length;
  const thin = html.filter((p) => (p.wordCount ?? 0) < 200).length;
  cards.push({ title: "Content", total: html.length, bars: [
    { label: "Unique", count: Math.max(0, html.length - dupes - thin), color: GREEN },
    { label: "Thin (<200 words)", count: thin, color: AMBER },
    { label: "Duplicate", count: dupes, color: RED },
  ]});

  // HTTP status
  const band = (lo: number, hi: number) => ps.filter((p) => p.status >= lo && p.status <= hi).length;
  cards.push({ title: "HTTP status", total: n, bars: [
    { label: "2xx OK", count: band(200, 299), color: GREEN },
    { label: "3xx redirect", count: band(300, 399), color: AMBER },
    { label: "4xx client error", count: band(400, 499), color: RED },
    { label: "5xx server error", count: band(500, 599), color: "#b91c1c" },
  ]});

  // Response speed
  const rt = (p: Pg) => p.responseTimeMs ?? 0;
  cards.push({ title: "Response speed", total: html.length, bars: [
    { label: "Fast (<500ms)", count: html.filter((p) => rt(p) < 500).length, color: GREEN },
    { label: "Moderate (0.5–1s)", count: html.filter((p) => rt(p) >= 500 && rt(p) < 1000).length, color: AMBER },
    { label: "Slow (>1s)", count: html.filter((p) => rt(p) >= 1000).length, color: RED },
  ]});

  // Crawl depth
  const depthAt = (d: number) => ps.filter((p) => (p.depth ?? 0) === d).length;
  cards.push({ title: "Crawl depth", total: n, bars: [
    { label: "Depth 0 (home)", count: depthAt(0), color: BLUE },
    { label: "Depth 1", count: depthAt(1), color: GREEN },
    { label: "Depth 2", count: depthAt(2), color: AMBER },
    { label: "Depth 3+", count: ps.filter((p) => (p.depth ?? 0) >= 3).length, color: RED },
  ]});

  // Security
  const isHttps = (p: Pg) => (p.finalUrl ?? p.url).startsWith("https://");
  cards.push({ title: "Security", total: n, bars: [
    { label: "HTTPS + HSTS", count: ps.filter((p) => isHttps(p) && p.hsts).length, color: GREEN },
    { label: "HTTPS only", count: ps.filter((p) => isHttps(p) && !p.hsts).length, color: AMBER },
    { label: "Mixed content / HTTP", count: ps.filter((p) => !isHttps(p) || (p.mixedContent ?? 0) > 0).length, color: RED },
  ]});

  // Social tags
  cards.push({ title: "Social tags (Open Graph)", total: html.length, bars: [
    { label: "OG + Twitter card", count: html.filter((p) => p.ogTitle && p.twitterCard).length, color: GREEN },
    { label: "Partial", count: html.filter((p) => (p.ogTitle || p.twitterCard) && !(p.ogTitle && p.twitterCard)).length, color: AMBER },
    { label: "Missing", count: html.filter((p) => !p.ogTitle && !p.twitterCard).length, color: RED },
  ]});

  // Images alt text (image-level)
  const imgTotal = html.reduce((a, p) => a + (p.imagesTotal ?? 0), 0);
  const imgMissing = html.reduce((a, p) => a + (p.imagesMissingAlt ?? 0), 0);
  if (imgTotal > 0) {
    cards.push({ title: "Image alt text", total: imgTotal, bars: [
      { label: "With alt text", count: imgTotal - imgMissing, color: GREEN },
      { label: "Missing alt text", count: imgMissing, color: RED },
    ]});
  }

  // Mobile
  cards.push({ title: "Mobile friendly", total: html.length, bars: [
    { label: "Has viewport", count: html.filter((p) => p.hasViewport).length, color: GREEN },
    { label: "No viewport", count: html.filter((p) => !p.hasViewport).length, color: RED },
  ]});

  // International
  const withHreflang = html.filter((p) => (p.hreflang ?? []).length > 0).length;
  if (withHreflang > 0) {
    cards.push({ title: "International (hreflang)", total: html.length, bars: [
      { label: "Has hreflang", count: withHreflang, color: GREEN },
      { label: "None", count: html.length - withHreflang, color: GREY },
    ]});
  }

  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-secondary)", marginBottom: 12 }}>Audit breakdowns</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        {cards.map((c) => <Breakdown key={c.title} title={c.title} total={c.total} bars={c.bars} />)}
      </div>
    </div>
  );
}

function Breakdown({ title, total, bars }: { title: string; total: number; bars: Seg[] }) {
  const shown = bars.filter((b) => b.count > 0);
  const sum = shown.reduce((a, b) => a + b.count, 0) || 1;
  return (
    <div style={{ background: "var(--panel, var(--bg))", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", flex: "0 0 auto" }}>{total.toLocaleString()}</div>
      </div>
      <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", background: "var(--panel-2, var(--border))" }}>
        {shown.map((b, i) => <div key={i} style={{ width: `${(b.count / sum) * 100}%`, background: b.color }} title={`${b.label}: ${b.count}`} />)}
      </div>
      <div style={{ display: "grid", gap: 4, marginTop: 10 }}>
        {shown.map((b, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color, flex: "0 0 auto" }} />
            <span style={{ color: "var(--text-secondary)" }}>{b.label}</span>
            <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{b.count.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
