import { useMemo, useState } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { Category, CrawlResult, GeoSignals, Issue, Page, Severity } from "../lib/types";
import { CATEGORY_LABELS } from "../lib/types";
import { ruleInfo } from "../lib/rules";
import { Donut, StackedBars, ProportionBar } from "../components/charts";
import { IconDownload, IconExternal, IconRefresh, IconShare, IconX, ScoreRing, SeverityBadge, StatusPill } from "../components/ui";
import { exportHtml, isTauri, openExternal } from "../lib/api";
import { topFixes } from "../lib/priority";
import { bytes, ms, num, severityRank, shortUrl } from "../lib/format";
import { LinkGraphView } from "./LinkGraphView";

type Tab = "overview" | "issues" | "pages" | "graph";

export function ResultsView({ result, onReset, onReports }: { result: CrawlResult; onReset: () => void; onReports: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [page, setPage] = useState<Page | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Cross-filter state, driven by the overview charts.
  const [sevFilter, setSevFilter] = useState<Severity | "all">("all");
  const [catFilter, setCatFilter] = useState<Category | null>(null);
  const [pageStatus, setPageStatus] = useState<number | null>(null);
  const [pageDepth, setPageDepth] = useState<number | null>(null);
  const s = result.summary;

  const goCategory = (c: Category) => { setCatFilter(c); setSevFilter("all"); setTab("issues"); };
  const goSeverity = (sv: Severity) => { setSevFilter(sv); setCatFilter(null); setTab("issues"); };
  const goStatus = (code: number) => { setPageStatus(code); setPageDepth(null); setTab("pages"); };
  const goDepth = (d: number) => { setPageDepth(d); setPageStatus(null); setTab("pages"); };

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

  // Clicking a page opens a dedicated full-screen detail view (with a sticky
  // breadcrumb), not a side drawer.
  if (page) {
    return (
      <PageDetail
        page={page}
        issues={result.issues.filter((i) => i.url === page.url)}
        reportName={hostOf(result.config.url)}
        crumb={tab === "graph" ? "Link graph" : tab === "issues" ? "Issues" : "Pages"}
        onBack={() => setPage(null)}
        onReports={onReports}
      />
    );
  }

  return (
    <>
      <div className="report-bar">
        <div className="report-bar-inner">
          <div className="row between wrap" style={{ gap: "var(--sp-3)" }} data-tauri-drag-region>
        <div className="row" style={{ gap: 12, alignItems: "center", minWidth: 0 }} data-tauri-drag-region>
        <img
          className="report-fav"
          style={{ width: 28, height: 28 }}
          src={faviconUrl(result.config.url)}
          alt=""
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
        />
        <div className="col" style={{ gap: 4, minWidth: 0 }} data-tauri-drag-region>
          <h1 className="h1" data-tauri-drag-region>{hostOf(result.config.url)}</h1>
          <span className="mono muted" style={{ fontSize: 13 }} data-tauri-drag-region>
            {result.startedAt ? `${fmtWhen(result.startedAt)} · ` : ""}
            {num(s.totalPages)} pages · {ms(s.durationMs)} · {num(s.indexablePages)} indexable
            {result.robotsFound ? " · robots.txt ✓" : ""}
            {result.sitemapUrls > 0 ? ` · ${num(result.sitemapUrls)} sitemap URLs` : ""}
            {result.llmsTxtFound ? " · llms.txt ✓" : ""}
          </span>
        </div>
        </div>
        <div className="row">
          <button className="btn btn-secondary btn-sm" onClick={() => download("csv")}><IconDownload size={15} /> CSV</button>
          <button className="btn btn-secondary btn-sm" onClick={() => download("json")}><IconDownload size={15} /> JSON</button>
          <button className="btn btn-secondary btn-sm" onClick={share} title={isTauri() ? "Save a shareable HTML report" : "Available in the desktop app"}><IconShare size={15} /> Share</button>
          <button className="btn btn-primary btn-sm" onClick={onReset}><IconRefresh size={15} /> New crawl</button>
        </div>
          </div>

          <div className="tabs">
            <Tabish id="overview" tab={tab} set={setTab}>Overview</Tabish>
            <Tabish id="issues" tab={tab} set={setTab} count={issueCount}>Issues</Tabish>
            <Tabish id="pages" tab={tab} set={setTab} count={result.pages.length}>Pages</Tabish>
            {result.linkGraph && result.linkGraph.nodes.length > 0 && (
              <Tabish id="graph" tab={tab} set={setTab}>Link graph</Tabish>
            )}
          </div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}

      <div className={`report-body${tab === "pages" || tab === "graph" ? " wide" : ""}`}>
      {tab === "overview" && <Overview result={result} onCategory={goCategory} onSeverity={goSeverity} onStatus={goStatus} onDepth={goDepth} />}
      {tab === "issues" && (
        <Issues
          result={result}
          sevFilter={sevFilter}
          setSevFilter={setSevFilter}
          catFilter={catFilter}
          setCatFilter={setCatFilter}
          onOpenUrl={(u) => openByUrl(result, u, setPage, setTab)}
        />
      )}
      {tab === "pages" && (
        <Pages
          pages={result.pages}
          statusFilter={pageStatus}
          setStatusFilter={setPageStatus}
          depthFilter={pageDepth}
          setDepthFilter={setPageDepth}
          onOpen={setPage}
        />
      )}
      {tab === "graph" && (
        <LinkGraphView result={result} onOpenUrl={(u) => openByUrl(result, u, setPage, setTab)} />
      )}

      </div>
    </>
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
function Overview({
  result,
  onCategory,
  onSeverity,
  onStatus,
  onDepth,
}: {
  result: CrawlResult;
  onCategory: (c: Category) => void;
  onSeverity: (s: Severity) => void;
  onStatus: (code: number) => void;
  onDepth: (d: number) => void;
}) {
  const s = result.summary;
  const statusRows = Object.entries(s.byStatus)
    .filter(([, v]) => v > 0)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([code, v]) => ({ label: code === "0" ? "Conn. error" : code, value: v, color: statusColor(Number(code)), key: code }));
  // Depth shaded on a sequential scale so each level is visually distinct and
  // deeper (harder-to-reach) pages run warmer.
  const DEPTH_COLORS = ["var(--green)", "var(--blue)", "#8b5cf6", "var(--amber)", "var(--red)"];
  const depthRows = Object.entries(s.byDepth)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([d, value]) => ({
      label: d === "0" ? "Home" : `${d} click${d === "1" ? "" : "s"}`,
      value,
      key: d,
      color: DEPTH_COLORS[Math.min(Number(d), DEPTH_COLORS.length - 1)],
    }));

  // Category rows broken down into error / warning / notice segments so each
  // bar shows the *mix*, not just a total.
  const catRows = useMemo(() => {
    const m = new Map<Category, { error: number; warning: number; notice: number }>();
    for (const i of result.issues) {
      if (i.severity === "good") continue;
      const e = m.get(i.category) ?? { error: 0, warning: 0, notice: 0 };
      e[i.severity as "error" | "warning" | "notice"]++;
      m.set(i.category, e);
    }
    return [...m.entries()]
      .map(([cat, d]) => ({
        label: CATEGORY_LABELS[cat],
        key: cat,
        total: d.error + d.warning + d.notice,
        segments: [
          { label: "Errors", value: d.error, color: "var(--red)" },
          { label: "Warnings", value: d.warning, color: "var(--amber)" },
          { label: "Notices", value: d.notice, color: "var(--notice)" },
        ],
      }))
      .sort((a, b) => b.total - a.total);
  }, [result.issues]);

  const fixes = topFixes(result.issues, 5);

  return (
    <div className="section-gap">
      {fixes.length > 0 && (
        <div className="card card-pad">
          <div className="row between" style={{ marginBottom: "var(--sp-4)" }}>
            <h3 className="h3">Top fixes</h3>
            <span className="tertiary" style={{ font: "var(--label-12)" }}>ranked by impact on your score</span>
          </div>
          <div className="col" style={{ gap: "var(--sp-3)" }}>
            {fixes.map((f, i) => (
              <div className="row" key={f.rule} style={{ gap: "var(--sp-3)", alignItems: "flex-start" }}>
                <span className="mono tertiary" style={{ fontSize: 13, width: 18, textAlign: "right", paddingTop: 2 }}>{i + 1}</span>
                <SeverityBadge severity={f.severity} />
                <div className="col" style={{ gap: 2, minWidth: 0 }}>
                  <span style={{ font: "var(--label-14)" }}>{f.title} <span className="tertiary mono" style={{ fontSize: 12 }}>· {f.count}</span></span>
                  {f.howToFix && <span className="muted" style={{ font: "var(--copy-13)" }}>{f.howToFix}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
        <div className="card score-card">
          <ScoreRing value={s.a11yScore} caption="A11Y" />
          <div className="meta">
            <span className="t">Accessibility</span>
            <span className="d">WCAG conformance — accessible names, labels, zoom and heading order. Scored apart from SEO.</span>
          </div>
        </div>
      </div>

      <div className="stats">
        <Stat k="Pages crawled" v={num(s.totalPages)} />
        <Stat k="Errors" v={num(s.errors)} tone={s.errors ? "error" : undefined} />
        <Stat k="Warnings" v={num(s.warnings)} tone={s.warnings ? "warning" : undefined} />
        <Stat k="Notices" v={num(s.notices)} tone={s.notices ? "notice" : undefined} />
        <Stat k="Indexable" v={`${pct(s.indexablePages, s.totalPages)}%`} sub={`${num(s.indexablePages)}/${num(s.totalPages)}`} />
        <Stat k="Duplicates" v={num(s.duplicatePages)} />
        <Stat k="Avg response" v={ms(s.avgResponseMs)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(280px, 1.3fr)", gap: "var(--sp-3)" }}>
        <div className="card card-pad">
          <h3 className="h3" style={{ marginBottom: "var(--sp-4)" }}>Issues by severity</h3>
          <Donut
            slices={[
              { label: "Errors", value: s.errors, color: "var(--red)", key: "error" },
              { label: "Warnings", value: s.warnings, color: "var(--amber)", key: "warning" },
              { label: "Notices", value: s.notices, color: "var(--notice)", key: "notice" },
            ]}
            onSelect={(k) => onSeverity(k as Severity)}
          />
        </div>
        <div className="card card-pad">
          <h3 className="h3" style={{ marginBottom: "var(--sp-4)" }}>Issues by category</h3>
          {catRows.length ? <StackedBars rows={catRows} onSelect={(k) => onCategory(k as Category)} /> : <Empty>No issues — clean crawl.</Empty>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
        <div className="card card-pad">
          <h3 className="h3" style={{ marginBottom: "var(--sp-4)" }}>Status codes</h3>
          <ProportionBar segments={statusRows} onSelect={(k) => onStatus(Number(k))} />
        </div>
        <div className="card card-pad">
          <h3 className="h3" style={{ marginBottom: "var(--sp-4)" }}>Crawl depth</h3>
          <ProportionBar segments={depthRows} onSelect={(k) => onDepth(Number(k))} />
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: "error" | "warning" | "notice" }) {
  const color =
    tone === "error" ? "var(--red-text)" : tone === "warning" ? "var(--amber-text)" : tone === "notice" ? "var(--notice-text)" : undefined;
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
function Issues({
  result,
  sevFilter,
  setSevFilter,
  catFilter,
  setCatFilter,
  onOpenUrl,
}: {
  result: CrawlResult;
  sevFilter: Severity | "all";
  setSevFilter: (s: Severity | "all") => void;
  catFilter: Category | null;
  setCatFilter: (c: Category | null) => void;
  onOpenUrl: (u: string) => void;
}) {
  const problems = result.issues.filter((i) => i.severity !== "good");

  const groups = useMemo(() => {
    const filtered = problems.filter(
      (i) => (sevFilter === "all" || i.severity === sevFilter) && (catFilter === null || i.category === catFilter)
    );
    const map = new Map<string, { rule: string; title: string; severity: Severity; category: Issue["category"]; items: Issue[] }>();
    for (const i of filtered) {
      const g = map.get(i.rule) ?? { rule: i.rule, title: i.title, severity: i.severity, category: i.category, items: [] };
      g.items.push(i);
      map.set(i.rule, g);
    }
    return [...map.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.items.length - a.items.length);
  }, [result.issues, sevFilter, catFilter]);

  return (
    <div className="section-gap">
      <div className="row between wrap" style={{ gap: "var(--sp-2)" }}>
        <div className="row wrap">
          <FilterChip active={sevFilter === "all"} onClick={() => setSevFilter("all")}>All <span className="mono">{problems.length}</span></FilterChip>
          <FilterChip active={sevFilter === "error"} onClick={() => setSevFilter("error")}><CircleAlert size={14} style={{ color: "var(--red-text)" }} /> Errors <span className="mono">{result.summary.errors}</span></FilterChip>
          <FilterChip active={sevFilter === "warning"} onClick={() => setSevFilter("warning")}><TriangleAlert size={14} style={{ color: "var(--amber-text)" }} /> Warnings <span className="mono">{result.summary.warnings}</span></FilterChip>
          <FilterChip active={sevFilter === "notice"} onClick={() => setSevFilter("notice")}><Info size={14} style={{ color: "var(--notice-text)" }} /> Notices <span className="mono">{result.summary.notices}</span></FilterChip>
        </div>
        {catFilter && (
          <button className="btn btn-sm btn-secondary" onClick={() => setCatFilter(null)} style={{ gap: 6 }}>
            {CATEGORY_LABELS[catFilter]} <IconX size={13} />
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="card card-pad"><Empty>No issues match this filter.</Empty></div>
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
type SortKey = "url" | "status" | "depth" | "wordCount" | "inlinks" | "linkScore" | "seoScore" | "responseTimeMs" | "geoScore";

function Pages({
  pages,
  statusFilter,
  setStatusFilter,
  depthFilter,
  setDepthFilter,
  onOpen,
}: {
  pages: Page[];
  statusFilter: number | null;
  setStatusFilter: (s: number | null) => void;
  depthFilter: number | null;
  setDepthFilter: (d: number | null) => void;
  onOpen: (p: Page) => void;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("depth");
  const [dir, setDir] = useState<1 | -1>(1);

  const rows = useMemo(() => {
    const f = pages.filter(
      (p) =>
        p.url.toLowerCase().includes(q.toLowerCase()) &&
        (statusFilter === null || p.status === statusFilter) &&
        (depthFilter === null || p.depth === depthFilter)
    );
    const val = (p: Page): number | string => (sort === "geoScore" ? p.geo.score : (p[sort as keyof Page] as number | string));
    return f.sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * dir;
      return (av - bv) * dir;
    });
  }, [pages, q, sort, dir, statusFilter, depthFilter]);

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
      <div className="row wrap" style={{ gap: "var(--sp-2)" }}>
        <input className="input input-sm mono" placeholder="Filter by URL…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
        {statusFilter !== null && (
          <button className="btn btn-sm btn-secondary" onClick={() => setStatusFilter(null)} style={{ gap: 6 }}>
            Status {statusFilter === 0 ? "error" : statusFilter} <IconX size={13} />
          </button>
        )}
        {depthFilter !== null && (
          <button className="btn btn-sm btn-secondary" onClick={() => setDepthFilter(null)} style={{ gap: 6 }}>
            Depth {depthFilter} <IconX size={13} />
          </button>
        )}
        <span className="tertiary mono" style={{ fontSize: 12, alignSelf: "center" }}>{rows.length} pages</span>
      </div>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              {th("url", "URL")}
              {th("status", "Status")}
              <th>Title</th>
              {th("depth", "Depth", "right")}
              {th("wordCount", "Words", "right")}
              {th("inlinks", "Inlinks", "right")}
              {th("linkScore", "Link", "right")}
              {th("seoScore", "SEO", "right")}
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
                <td className="num">{Math.round(p.linkScore)}</td>
                <td className="num" style={{ color: p.status === 200 ? scoreColor(p.seoScore) : "var(--text-tertiary)" }}>
                  {p.status === 200 ? p.seoScore : "—"}
                </td>
                <td className="num" style={{ color: p.status === 200 ? scoreColor(p.geo.score) : "var(--text-tertiary)" }}>
                  {p.status === 200 ? p.geo.score : "—"}
                </td>
                <td>{p.indexable ? <span className="badge badge-ok"><span className="dot" />Yes</span> : <span className="badge badge-neutral" title={p.indexability ?? ""}>{p.indexability ?? "No"}</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10}><Empty>No pages match.</Empty></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Drawer ---------------- */
function PageDetail({
  page,
  issues,
  reportName,
  crumb,
  onBack,
  onReports,
}: {
  page: Page;
  issues: Issue[];
  reportName: string;
  crumb: string;
  onBack: () => void;
  onReports: () => void;
}) {
  const problems = issues.filter((i) => i.severity !== "good");
  return (
    <>
      <div className="report-bar">
        <div className="report-bar-inner crumbs-only">
          <nav className="crumbs" data-tauri-drag-region>
            <button className="crumb-link" onClick={onReports}>Reports</button>
            <span className="crumb-sep">/</span>
            <button className="crumb-link" onClick={onBack}>{reportName}</button>
            <span className="crumb-sep">/</span>
            <button className="crumb-link" onClick={onBack}>{crumb}</button>
            <span className="crumb-sep">/</span>
            <span className="crumb-current mono">{shortUrl(page.url)}</span>
          </nav>
        </div>
      </div>
      <div className="report-body">
        <div className="section-gap" style={{ maxWidth: 960, margin: "0 auto", width: "100%", padding: "var(--sp-5) var(--sp-5) var(--sp-7)" }}>
          <div className="row between wrap" style={{ gap: "var(--sp-3)", alignItems: "flex-start" }}>
            <div className="col" style={{ gap: 10, minWidth: 0 }}>
              <h1 style={{ margin: 0, font: "var(--heading-24)", letterSpacing: "-0.01em" }}>{page.title ?? shortUrl(page.url)}</h1>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <StatusPill status={page.status} />
                <MetaPill>depth {page.depth}</MetaPill>
                {page.status === 200 && <MetaPill color={scoreColor(page.seoScore)}>SEO {page.seoScore}</MetaPill>}
                {page.status === 200 && <MetaPill color={scoreColor(page.geo.score)}>GEO {page.geo.score}</MetaPill>}
              </div>
              <span className="mono tertiary" style={{ fontSize: 12.5, wordBreak: "break-all" }}>{page.url}</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => openExternal(page.finalUrl)} style={{ flex: "0 0 auto" }}>
              <IconExternal size={15} /> Open URL
            </button>
          </div>
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
            <Row k="Link score" v={`${Math.round(page.linkScore)} / 100`} />
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
      </div>
    </>
  );
}

function MetaPill({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: "var(--radius-full)",
        background: "var(--bg-2)",
        border: "1px solid var(--border)",
        color: color ?? "var(--text-secondary)",
      }}
    >
      {children}
    </span>
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
function faviconUrl(url: string): string {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).host}&sz=64`;
  } catch {
    return "";
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
