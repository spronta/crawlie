import { useMemo, useState } from "react";
import type { CrawlResult, GeoSignals, Issue, Page, Severity } from "../lib/types";
import { CATEGORY_LABELS } from "../lib/types";
import { ruleInfo } from "../lib/rules";
import { Donut, Bars } from "../components/charts";
import { IconDownload, IconRefresh, IconShare, IconX, ScoreRing, SeverityBadge, StatusPill } from "../components/ui";
import { exportHtml, isTauri } from "../lib/api";
import { bytes, ms, num, severityRank, shortUrl } from "../lib/format";

type Tab = "overview" | "issues" | "pages";

export function ResultsView({ result, onReset }: { result: CrawlResult; onReset: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [page, setPage] = useState<Page | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const s = result.summary;

  async function share() {
    const path = await exportHtml(result);
    setToast(path ? `Saved report to ${path}` : "HTML export is available in the desktop app");
    setTimeout(() => setToast(null), 4500);
  }

  function download(kind: "json" | "csv") {
    let blob: Blob;
    let name: string;
    if (kind === "json") {
      blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      name = "crawlie-report.json";
    } else {
      const head = "severity,category,rule,title,url,detail\n";
      const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const body = result.issues
        .filter((i) => i.severity !== "good")
        .map((i) => [i.severity, CATEGORY_LABELS[i.category], i.rule, i.title, i.url, i.detail ?? ""].map((x) => esc(String(x))).join(","))
        .join("\n");
      blob = new Blob([head + body], { type: "text/csv" });
      name = "crawlie-issues.csv";
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const issueCount = result.issues.filter((i) => i.severity !== "good").length;

  return (
    <div className="section-gap">
      <div className="row between wrap" style={{ gap: "var(--sp-3)" }}>
        <div className="col" style={{ gap: 4 }}>
          <h1 className="h1">{hostOf(result.config.url)}</h1>
          <span className="mono muted" style={{ fontSize: 13 }}>
            {result.startedAt ? `${fmtWhen(result.startedAt)} · ` : ""}
            {num(s.totalPages)} pages · {ms(s.durationMs)} · {num(s.indexablePages)} indexable
            {result.robotsFound ? " · robots.txt ✓" : ""}
            {result.sitemapUrls > 0 ? ` · ${num(result.sitemapUrls)} sitemap URLs` : ""}
          </span>
        </div>
        <div className="row">
          <button className="btn btn-secondary btn-sm" onClick={() => download("csv")}><IconDownload size={15} /> CSV</button>
          <button className="btn btn-secondary btn-sm" onClick={() => download("json")}><IconDownload size={15} /> JSON</button>
          <button className="btn btn-secondary btn-sm" onClick={share} title={isTauri() ? "Save a shareable HTML report" : "Available in the desktop app"}><IconShare size={15} /> Share</button>
          <button className="btn btn-primary btn-sm" onClick={onReset}><IconRefresh size={15} /> New crawl</button>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}

      <div className="tabs">
        <Tabish id="overview" tab={tab} set={setTab}>Overview</Tabish>
        <Tabish id="issues" tab={tab} set={setTab} count={issueCount}>Issues</Tabish>
        <Tabish id="pages" tab={tab} set={setTab} count={result.pages.length}>Pages</Tabish>
      </div>

      {tab === "overview" && <Overview result={result} />}
      {tab === "issues" && <Issues result={result} onOpenUrl={(u) => openByUrl(result, u, setPage, setTab)} />}
      {tab === "pages" && <Pages pages={result.pages} onOpen={setPage} />}

      {page && <PageDrawer page={page} issues={result.issues.filter((i) => i.url === page.url)} onClose={() => setPage(null)} />}
    </div>
  );
}

function openByUrl(result: CrawlResult, url: string, setPage: (p: Page | null) => void, setTab: (t: Tab) => void) {
  const p = result.pages.find((x) => x.url === url || x.finalUrl === url);
  if (p) {
    setTab("pages");
    setPage(p);
  }
}

function Tabish({ id, tab, set, count, children }: { id: Tab; tab: Tab; set: (t: Tab) => void; count?: number; children: React.ReactNode }) {
  return (
    <button className={`tab ${tab === id ? "active" : ""}`} onClick={() => set(id)}>
      {children}
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );
}

/* ---------------- Overview ---------------- */
function Overview({ result }: { result: CrawlResult }) {
  const s = result.summary;
  const statusRows = Object.entries(s.byStatus)
    .filter(([, v]) => v > 0)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([code, v]) => ({ label: code === "0" ? "Conn. error" : code, value: v, color: statusColor(Number(code)) }));
  const catRows = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  const depthRows = Object.entries(s.byDepth)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([d, value]) => ({ label: d === "0" ? "Home" : `${d} clicks`, value, color: "var(--blue)" }));

  return (
    <div className="section-gap">
      <div className="score-cards">
        <div className="card score-card">
          <ScoreRing value={s.healthScore} caption="HEALTH" />
          <div className="meta">
            <span className="t">Technical SEO Health</span>
            <span className="d">Weighted across {num(s.totalPages)} pages — errors, warnings and notices. Higher is healthier.</span>
          </div>
        </div>
        <div className="card score-card">
          <ScoreRing value={s.geoScore} caption="GEO" />
          <div className="meta">
            <span className="t">Generative Engine Readiness</span>
            <span className="d">How citable your pages are by AI search (ChatGPT, Perplexity, AI Overviews).</span>
          </div>
        </div>
      </div>

      <div className="stats">
        <Stat k="Pages crawled" v={num(s.totalPages)} />
        <Stat k="Errors" v={num(s.errors)} tone={s.errors ? "error" : undefined} />
        <Stat k="Warnings" v={num(s.warnings)} tone={s.warnings ? "warning" : undefined} />
        <Stat k="Notices" v={num(s.notices)} />
        <Stat k="Indexable" v={`${pct(s.indexablePages, s.totalPages)}%`} sub={`${num(s.indexablePages)}/${num(s.totalPages)}`} />
        <Stat k="Duplicates" v={num(s.duplicatePages)} />
        <Stat k="Avg response" v={ms(s.avgResponseMs)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(280px, 1.3fr)", gap: "var(--sp-3)" }}>
        <div className="card card-pad">
          <h3 className="h3" style={{ marginBottom: "var(--sp-4)" }}>Issues by severity</h3>
          <Donut
            slices={[
              { label: "Errors", value: s.errors, color: "var(--red)" },
              { label: "Warnings", value: s.warnings, color: "var(--amber)" },
              { label: "Notices", value: s.notices, color: "var(--text-tertiary)" },
            ]}
          />
        </div>
        <div className="card card-pad">
          <h3 className="h3" style={{ marginBottom: "var(--sp-4)" }}>Issues by category</h3>
          {catRows.length ? <Bars rows={catRows} /> : <Empty>No issues — clean crawl.</Empty>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
        <div className="card card-pad">
          <h3 className="h3" style={{ marginBottom: "var(--sp-4)" }}>Status codes</h3>
          <Bars rows={statusRows} />
        </div>
        <div className="card card-pad">
          <h3 className="h3" style={{ marginBottom: "var(--sp-4)" }}>Crawl depth</h3>
          <Bars rows={depthRows} />
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: "error" | "warning" }) {
  const color = tone === "error" ? "var(--red-text)" : tone === "warning" ? "var(--amber-text)" : undefined;
  return (
    <div className="card stat">
      <div className="k">{k}</div>
      <div className="v" style={{ color }}>
        {v}
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}

/* ---------------- Issues ---------------- */
function Issues({ result, onOpenUrl }: { result: CrawlResult; onOpenUrl: (u: string) => void }) {
  const [filter, setFilter] = useState<Severity | "all">("all");
  const problems = result.issues.filter((i) => i.severity !== "good");

  const groups = useMemo(() => {
    const filtered = problems.filter((i) => filter === "all" || i.severity === filter);
    const map = new Map<string, { rule: string; title: string; severity: Severity; category: Issue["category"]; items: Issue[] }>();
    for (const i of filtered) {
      const g = map.get(i.rule) ?? { rule: i.rule, title: i.title, severity: i.severity, category: i.category, items: [] };
      g.items.push(i);
      map.set(i.rule, g);
    }
    return [...map.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.items.length - a.items.length);
  }, [result.issues, filter]);

  return (
    <div className="section-gap">
      <div className="row wrap">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>All <span className="mono">{problems.length}</span></FilterChip>
        <FilterChip active={filter === "error"} onClick={() => setFilter("error")}><span className="badge badge-error"><span className="dot" /></span> Errors <span className="mono">{result.summary.errors}</span></FilterChip>
        <FilterChip active={filter === "warning"} onClick={() => setFilter("warning")}><span className="badge badge-warning"><span className="dot" /></span> Warnings <span className="mono">{result.summary.warnings}</span></FilterChip>
        <FilterChip active={filter === "notice"} onClick={() => setFilter("notice")}><span className="badge badge-notice"><span className="dot" /></span> Notices <span className="mono">{result.summary.notices}</span></FilterChip>
      </div>

      {groups.length === 0 ? (
        <div className="card card-pad"><Empty>No issues found 🎉</Empty></div>
      ) : (
        <div>{groups.map((g) => <IssueGroup key={g.rule} group={g} onOpenUrl={onOpenUrl} />)}</div>
      )}
    </div>
  );
}

function IssueGroup({ group, onOpenUrl }: { group: { rule: string; title: string; severity: Severity; category: Issue["category"]; items: Issue[] }; onOpenUrl: (u: string) => void }) {
  const [open, setOpen] = useState(false);
  const info = ruleInfo(group.rule);
  return (
    <div className="issue-group">
      <button className={`issue-head ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
        <span className="chev"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg></span>
        <SeverityBadge severity={group.severity} />
        <span className="title grow">{group.title}</span>
        <span className="cat-pill">{CATEGORY_LABELS[group.category]}</span>
        <span className="mono muted">{group.items.length}</span>
      </button>
      {open && (
        <>
          {info && (
            <div className="edu">
              <div className="col"><b>Why it matters</b><p>{info.why}</p></div>
              <div className="col"><b>How to fix</b><p>{info.howToFix}</p></div>
              <div className="col"><b>If ignored</b><p>{info.impact}</p></div>
            </div>
          )}
          <div className="issue-urls">
            {group.items.slice(0, 200).map((i, idx) => (
              <div className="issue-url" key={idx} onClick={() => onOpenUrl(i.url)} style={{ cursor: "pointer" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortUrl(i.url)}</span>
                {i.detail && <span className="detail">{i.detail}</span>}
              </div>
            ))}
            {group.items.length > 200 && <div className="issue-url tertiary">+ {group.items.length - 200} more</div>}
          </div>
        </>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`btn btn-sm ${active ? "btn-secondary" : "btn-ghost"}`} onClick={onClick} style={{ gap: 6 }}>
      {children}
    </button>
  );
}

/* ---------------- Pages ---------------- */
type SortKey = "url" | "status" | "depth" | "wordCount" | "inlinks" | "responseTimeMs" | "geoScore";

function Pages({ pages, onOpen }: { pages: Page[]; onOpen: (p: Page) => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("depth");
  const [dir, setDir] = useState<1 | -1>(1);

  const rows = useMemo(() => {
    const f = pages.filter((p) => p.url.toLowerCase().includes(q.toLowerCase()));
    const val = (p: Page): number | string => (sort === "geoScore" ? p.geo.score : (p[sort as keyof Page] as number | string));
    return f.sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * dir;
      return (av - bv) * dir;
    });
  }, [pages, q, sort, dir]);

  function th(key: SortKey, label: string, align?: "right") {
    const active = sort === key;
    return (
      <th onClick={() => (active ? setDir((d) => (d === 1 ? -1 : 1)) : (setSort(key), setDir(1)))} style={{ textAlign: align }}>
        {label}
        {active && <span className="arrow">{dir === 1 ? "↑" : "↓"}</span>}
      </th>
    );
  }

  return (
    <div className="section-gap">
      <input className="input input-sm mono" placeholder="Filter by URL…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
      <div className="table-wrap" style={{ maxHeight: "62vh" }}>
        <table className="grid">
          <thead>
            <tr>
              {th("url", "URL")}
              {th("status", "Status")}
              <th>Title</th>
              {th("depth", "Depth", "right")}
              {th("wordCount", "Words", "right")}
              {th("inlinks", "Inlinks", "right")}
              {th("geoScore", "GEO", "right")}
              <th>Indexable</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.url} onClick={() => onOpen(p)}>
                <td><div className="cell-url" title={p.url}>{shortUrl(p.url)}</div></td>
                <td><StatusPill status={p.status} /></td>
                <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.title ?? ""}>
                  {p.title ?? <span className="tertiary">—</span>}
                </td>
                <td className="num">{p.depth}</td>
                <td className="num">{num(p.wordCount)}</td>
                <td className="num">{p.inlinks}</td>
                <td className="num" style={{ color: p.status === 200 ? scoreColor(p.geo.score) : "var(--text-tertiary)" }}>
                  {p.status === 200 ? p.geo.score : "—"}
                </td>
                <td>{p.indexable ? <span className="badge badge-ok"><span className="dot" />Yes</span> : <span className="badge badge-neutral" title={p.indexability ?? ""}>{p.indexability ?? "No"}</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8}><Empty>No pages match.</Empty></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Drawer ---------------- */
function PageDrawer({ page, issues, onClose }: { page: Page; issues: Issue[]; onClose: () => void }) {
  const problems = issues.filter((i) => i.severity !== "good");
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div className="col" style={{ gap: 6, minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}>
              <StatusPill status={page.status} />
              <span className="muted mono" style={{ fontSize: 12 }}>depth {page.depth}</span>
              {page.status === 200 && <span className="mono" style={{ fontSize: 12, color: scoreColor(page.geo.score) }}>GEO {page.geo.score}</span>}
            </div>
            <span className="mono" style={{ fontSize: 13, wordBreak: "break-all" }}>{page.url}</span>
          </div>
          <button className="icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="drawer-body section-gap">
          {problems.length > 0 && (
            <div className="col" style={{ gap: 8 }}>
              <span className="h3">Issues <span className="mono muted">{problems.length}</span></span>
              {problems.map((i, idx) => (
                <div className="row between" key={idx} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <span className="row" style={{ gap: 8 }}><SeverityBadge severity={i.severity} /><span style={{ font: "var(--label-13)" }}>{i.title}</span></span>
                  {i.detail && <span className="tertiary mono" style={{ fontSize: 12 }}>{i.detail}</span>}
                </div>
              ))}
            </div>
          )}

          {page.status === 200 && <GeoCard geo={page.geo} />}

          <dl className="kv">
            <Row k="Final URL" v={page.finalUrl} mono />
            <Row k="Title" v={page.title ?? "—"} />
            {page.title && <Row k="Title length" v={`${page.title.length} chars`} />}
            <Row k="Meta description" v={page.metaDescription ?? "—"} />
            <Row k="H1 / H2 / H3" v={`${page.h1.length ? page.h1.join(" · ") : "—"}  ·  ${page.h2Count} · ${page.h3Count}`} />
            <Row k="Word count" v={num(page.wordCount)} />
            <Row k="Canonical" v={page.canonical ?? "—"} mono />
            <Row k="Indexable" v={page.indexable ? "Yes" : `No — ${page.indexability ?? ""}`} />
            <Row k="Meta robots" v={page.metaRobots ?? "—"} mono />
            {page.xRobotsTag && <Row k="X-Robots-Tag" v={page.xRobotsTag} mono />}
            <Row k="Schema types" v={page.schemaTypes.length ? page.schemaTypes.join(", ") : "—"} />
            <Row k="Open Graph" v={page.ogTitle ? "Present" : "Missing"} />
            <Row k="Twitter card" v={page.twitterCard ?? "—"} />
            <Row k="Viewport" v={page.hasViewport ? "Yes" : "No"} />
            <Row k="Images" v={`${page.imagesTotal} (${page.imagesMissingAlt} missing alt)`} />
            <Row k="Internal / External links" v={`${num(page.internalLinks.length)} / ${num(page.externalLinks.length)}`} />
            <Row k="Inlinks" v={num(page.inlinks)} />
            <Row k="Response" v={`${ms(page.responseTimeMs)} · ${bytes(page.sizeBytes)}`} />
            <Row k="Compression" v={page.contentEncoding ?? "none"} />
            <Row k="HSTS" v={page.hsts ? "Yes" : "No"} />
            {page.server && <Row k="Server" v={page.server} mono />}
            <Row k="Content type" v={page.contentType ?? "—"} mono />
            {page.lang && <Row k="Language" v={page.lang} />}
            {page.hreflang.length > 0 && <Row k="hreflang" v={page.hreflang.map((h) => h.lang).join(", ")} />}
            {page.duplicateOf && <Row k="Duplicate of" v={page.duplicateOf} mono />}
            {page.redirectChain.length > 0 && <Row k="Redirects" v={page.redirectChain.map((r) => `${r.status} → ${shortUrl(r.to)}`).join("\n")} mono />}
            {page.error && <Row k="Error" v={page.error} />}
          </dl>
        </div>
      </aside>
    </>
  );
}

function GeoCard({ geo }: { geo: GeoSignals }) {
  const chip = (on: boolean, label: string) => (
    <span className={`geo-chip ${on ? "on" : "off"}`}>{on ? "✓" : "○"} {label}</span>
  );
  return (
    <div className="card card-pad col" style={{ gap: "var(--sp-3)" }}>
      <div className="row between">
        <span className="h3">GEO readiness</span>
        <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: scoreColor(geo.score) }}>{geo.score}<span className="tertiary" style={{ fontSize: 12 }}>/100</span></span>
      </div>
      <div className="geo-signals">
        {chip(geo.structuredData, "Structured data")}
        {chip(geo.semanticHtml, "Semantic HTML")}
        {chip(geo.answerable, "Answer-ready")}
        {chip(geo.hasAuthor, "Authorship")}
        {chip(geo.hasDate, "Dated")}
        {chip(geo.faqSchema, "FAQ schema")}
        {chip(geo.questionHeadings > 0, `${geo.questionHeadings} Q-headings`)}
        {chip(geo.structuredBlocks > 0, `${geo.structuredBlocks} lists/tables`)}
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className={mono ? "mono" : ""} style={{ fontSize: mono ? 12 : undefined, whiteSpace: "pre-wrap" }}>{v}</dd>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="tertiary" style={{ padding: "var(--sp-5)", textAlign: "center", font: "var(--copy-14)" }}>{children}</div>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
function fmtWhen(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "";
  }
}
function pct(a: number, b: number): number {
  return b ? Math.round((a / b) * 100) : 0;
}
function scoreColor(n: number): string {
  return n >= 80 ? "var(--green-text)" : n >= 50 ? "var(--amber-text)" : "var(--red-text)";
}
function statusColor(code: number): string {
  if (code === 0 || code >= 400) return "var(--red)";
  if (code >= 300) return "var(--amber)";
  return "var(--green)";
}
