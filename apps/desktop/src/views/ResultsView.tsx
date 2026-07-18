import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, CircleAlert, Clipboard, Info, Search, TriangleAlert } from "lucide-react";
import type { BrokenLink, Category, CrawlResult, GeoSignals, Issue, Page, PageRow, Severity } from "../lib/types";
import { CATEGORY_LABELS } from "../lib/types";
import { ruleInfo, setCustomRules } from "../lib/rules";
import { Donut, StackedBars, ProportionBar } from "../components/charts";
import { IconDownload, IconExternal, IconRefresh, IconShare, IconX, ScoreRing, SeverityBadge, StatusPill } from "../components/ui";
import { exportHtml, isTauri, openExternal } from "@platform/api";
import { topFixes, topFixesFromRollup } from "../lib/priority";
import { bytes, ms, num, severityRank, shortUrl } from "../lib/format";
import { LinkGraphView } from "./LinkGraphView";

type Tab = string;

/** Host-injected extra tabs (used by the cloud report to add Insights, Rules,
 *  Extraction into the same tab bar instead of stacking them above). */
export interface ExtraTab {
  id: string;
  label: string;
  count?: number;
  wide?: boolean;
  content: React.ReactNode;
}

/** Host-injected evidence layers for the page-level Content 360 view. The
 * shared crawler owns Summary, Content, Technical and Raw data; cloud products
 * add real data-backed sections such as Discoverability and History. */
export interface PageDetailSection {
  id: string;
  label: string;
  content: React.ReactNode;
}

/** Public-link plumbing injected by the cloud report view. When present, the
 *  header's Share button opens the share popover instead of the desktop's
 *  HTML export. */
export interface Sharing {
  /** Current public link, or null while the report is private. */
  url: string | null;
  /** Create (or return) the public link. */
  onShare: () => Promise<string>;
  /** Revoke the link — it stops working immediately. */
  onUnshare: () => Promise<void>;
}

/** Everything reachable by clicking, serialized so any view is a shareable URL:
 *  the active tab, an open page, the issue/page cross-filters, and a focused
 *  issue rule. The host (cloud dashboard) maps this to/from the query string. */
export interface ReportViewState {
  tab: string;
  page: string | null;
  pageSection: string;
  sev: Severity | "all";
  cat: Category | null;
  status: number | null;
  depth: number | null;
  rule: string | null;
}

function sameView(a: ReportViewState, b?: ReportViewState): boolean {
  if (!b) return false;
  return (
    a.tab === b.tab &&
    (a.page ?? null) === (b.page ?? null) &&
    (a.pageSection ?? "overview") === (b.pageSection ?? "overview") &&
    (a.sev ?? "all") === (b.sev ?? "all") &&
    (a.cat ?? null) === (b.cat ?? null) &&
    (a.status ?? null) === (b.status ?? null) &&
    (a.depth ?? null) === (b.depth ?? null) &&
    (a.rule ?? null) === (b.rule ?? null)
  );
}

export function ResultsView({
  result,
  onReset,
  onReports,
  extraTabs,
  resolvePage,
  sharing,
  view,
  onView,
  onOpenIssue,
  freshness,
  onViewLatest,
  pageSections,
  pageCrumb,
}: {
  result: CrawlResult;
  onReset: () => void;
  onReports: () => void;
  extraTabs?: ExtraTab[];
  /** Fetch the full Page for a row whose record isn't in memory (lean
   *  reports resolve it from the row's stored chunk). */
  resolvePage?: (row: PageRow) => Promise<Page | null>;
  sharing?: Sharing;
  /** Route-driven view state (deep links + back/forward). When `onView` is
   *  provided, all view state (tab, open page, filters, focused rule) mirrors
   *  into the host's URL; without it everything stays internal (desktop). */
  view?: ReportViewState;
  onView?: (v: ReportViewState) => void;
  /** When set, issue groups offer "Open as page" (hosted drill-down route). */
  onOpenIssue?: (rule: string) => void;
  /** Whether this saved report is the newest crawl of its site (host-computed).
   *  Renders a Latest / Outdated badge beside the domain. */
  freshness?: "latest" | "outdated";
  /** Jump to the newest report of this site (makes the Outdated badge a link). */
  onViewLatest?: () => void;
  /** Host-injected evidence layers for the page-level Content 360 view. */
  pageSections?: (page: Page) => PageDetailSection[];
  /** Override the page-detail breadcrumb prefix (host owns the crumb + click).
   *  When set, the page view shows `{label} / {url}` instead of the default
   *  `Reports / {host} / {tab} / {url}` — used by the hosted /pages/:slug route. */
  pageCrumb?: { label: string; onClick: () => void };
}) {
  const controlled = !!onView;
  const [tab, setTab] = useState<Tab>(view?.tab ?? "overview");
  // `openPageUrl` is the routable string (synchronous source of truth); `page`
  // is the resolved Page object rendered in the detail view.
  const [openPageUrl, setOpenPageUrl] = useState<string | null>(view?.page ?? null);
  const [pageSection, setPageSection] = useState(view?.pageSection ?? "overview");
  const [page, setPage] = useState<Page | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Cross-filter state, driven by the overview charts.
  const [sevFilter, setSevFilter] = useState<Severity | "all">(view?.sev ?? "all");
  const [catFilter, setCatFilter] = useState<Category | null>(view?.cat ?? null);
  const [pageStatus, setPageStatus] = useState<number | null>(view?.status ?? null);
  const [pageDepth, setPageDepth] = useState<number | null>(view?.depth ?? null);
  // The issue rule to auto-expand + scroll to (from a deep link or the palette).
  const [focusRule, setFocusRule] = useState<string | null>(view?.rule ?? null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const s = result.summary;
  // Register the report's custom-rule guidance so ruleInfo() (issue groups,
  // top fixes) explains user-defined checks like built-ins.
  useMemo(() => setCustomRules(result.customRules), [result]);

  // The Pages table browses the FULL crawl: from the compact index when this
  // is a lean (big) report, else from the in-memory pages.
  const pageRows: PageRow[] = useMemo(() => {
    if (result.pageIndex?.length) return result.pageIndex;
    return result.pages.map((p) => ({
      url: p.url,
      finalUrl: p.finalUrl,
      status: p.status,
      depth: p.depth,
      title: p.title,
      indexable: p.indexable,
      indexability: p.indexability,
      wordCount: p.wordCount,
      inlinks: p.inlinks,
      linkScore: p.linkScore,
      seoScore: p.seoScore,
      geoScore: p.geo.score,
      page: p,
    }));
  }, [result]);

  const [rowLoading, setRowLoading] = useState<string | null>(null);
  // Open a page = set the routable URL; the resolve effect below turns it into
  // a Page object. Works the same controlled (URL-driven) or not (desktop).
  const openRow = (row: PageRow) => { setPageSection("overview"); setOpenPageUrl(row.url); };
  const openUrl = (u: string) => {
    const row = pageRows.find((r) => r.url === u || r.finalUrl === u);
    if (row) {
      setTab("pages");
      setPageSection("overview");
      setOpenPageUrl(row.url);
    }
  };

  // Resolve `openPageUrl` → the full Page object for the detail view. Cancels
  // cleanly if the target changes mid-fetch (fast back/forward, palette jumps).
  useEffect(() => {
    if (!openPageUrl) {
      setPage(null);
      return;
    }
    if (page && (page.url === openPageUrl || page.finalUrl === openPageUrl)) return;
    const row = pageRows.find((r) => r.url === openPageUrl || r.finalUrl === openPageUrl);
    if (!row) {
      setPage(null);
      return;
    }
    let cancelled = false;
    (async () => {
      if (row.page) return void (!cancelled && setPage(row.page));
      const inMemory = result.pages.find((p) => p.url === row.url || p.finalUrl === row.url);
      if (inMemory) return void (!cancelled && setPage(inMemory));
      if (!resolvePage) return;
      setRowLoading(row.url);
      try {
        const p = await resolvePage(row);
        if (cancelled) return;
        if (p) setPage(p);
        else {
          setToast("Couldn't load this page's details. Try again.");
          setTimeout(() => setToast(null), 3500);
        }
      } finally {
        if (!cancelled) setRowLoading(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPageUrl, pageRows]);

  // Internal state → URL (controlled only). Fires ONLY when internal state
  // changes (a user action), never when the `view` prop echoes back — that
  // would loop. The sameView() guard against the current `view` (read from a
  // ref, not a dep) suppresses the redundant push on mount and after a
  // back/forward-driven internal update.
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (!onView) return;
    const next: ReportViewState = { tab, page: openPageUrl, pageSection, sev: sevFilter, cat: catFilter, status: pageStatus, depth: pageDepth, rule: focusRule };
    if (!sameView(next, viewRef.current)) onView(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, openPageUrl, pageSection, sevFilter, catFilter, pageStatus, pageDepth, focusRule]);

  // URL → internal state (controlled only): back/forward + cold deep links.
  useEffect(() => {
    if (!controlled || !view) return;
    if (view.tab !== tab) setTab(view.tab);
    if ((view.page ?? null) !== openPageUrl) setOpenPageUrl(view.page ?? null);
    if ((view.pageSection ?? "overview") !== pageSection) setPageSection(view.pageSection ?? "overview");
    if ((view.sev ?? "all") !== sevFilter) setSevFilter(view.sev ?? "all");
    if ((view.cat ?? null) !== catFilter) setCatFilter(view.cat ?? null);
    if ((view.status ?? null) !== pageStatus) setPageStatus(view.status ?? null);
    if ((view.depth ?? null) !== pageDepth) setPageDepth(view.depth ?? null);
    if ((view.rule ?? null) !== focusRule) setFocusRule(view.rule ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const goCategory = (c: Category) => { setCatFilter(c); setSevFilter("all"); setTab("issues"); };
  const goSeverity = (sv: Severity) => { setSevFilter(sv); setCatFilter(null); setTab("issues"); };
  const goStatus = (code: number) => { setPageStatus(code); setPageDepth(null); setTab("pages"); };
  const goDepth = (d: number) => { setPageDepth(d); setPageStatus(null); setTab("pages"); };
  const goRule = (rule: string) => { setFocusRule(rule); setSevFilter("all"); setCatFilter(null); setTab("issues"); };

  // ⌘K / Ctrl-K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  // Lean (big) reports carry a capped issue sample; the summary has the truth.
  const issueCount = result.issuesTruncated
    ? s.errors + s.warnings + s.notices
    : result.issues.filter((i) => i.severity !== "good").length;

  // The palette is mounted in both the report and page-detail views, so ⌘K
  // works everywhere. Navigation actions clear any open page as needed.
  const paletteEl = paletteOpen ? (
    <CommandPalette
      result={result}
      pageRows={pageRows}
      extraTabs={extraTabs}
      hasGraph={!!result.linkGraph && result.linkGraph.nodes.length > 0}
      onClose={() => setPaletteOpen(false)}
      onTab={(t) => { setOpenPageUrl(null); setTab(t); }}
      onOpenPage={(url) => { setTab("pages"); setOpenPageUrl(url); }}
      onRule={(r) => { setOpenPageUrl(null); goRule(r); }}
      onNewCrawl={onReset}
      onDownload={download}
    />
  ) : null;

  // Clicking a page opens a dedicated full-screen detail view (with a sticky
  // breadcrumb), not a side drawer.
  if (page) {
    return (
      <>
        <PageDetail
          page={page}
          issues={result.issues.filter((i) => i.url === page.url)}
          reportName={hostOf(result.config.url)}
          crumb={tab === "graph" ? "Link graph" : tab === "issues" ? "Issues" : "Pages"}
          onBack={() => setOpenPageUrl(null)}
          onReports={onReports}
          onSearch={() => setPaletteOpen(true)}
          activeSection={pageSection}
          onSectionChange={setPageSection}
          sections={pageSections?.(page) ?? []}
          pageCrumb={pageCrumb}
        />
        {paletteEl}
      </>
    );
  }

  return (
    <>
      <div className="report-bar">
        <div className="report-bar-inner">
          <div className="row between wrap" style={{ gap: "var(--sp-3)" }} data-tauri-drag-region>
        <div className="report-id" data-tauri-drag-region>
          <img
            className="report-fav"
            src={faviconUrl(result.config.url, result.favicon)}
            alt=""
            loading="lazy"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
          />
          <div className="crumbs" data-tauri-drag-region>
            <button className="crumb-link" onClick={onReports}>Reports</button>
            <span className="crumb-sep" aria-hidden="true">/</span>
            <span className="crumb-current">{hostOf(result.config.url)}</span>
            {freshness === "latest" && <span className="freshness latest">Latest</span>}
            {freshness === "outdated" && (
              onViewLatest ? (
                <button className="freshness outdated" onClick={onViewLatest} title="A newer crawl of this site exists — open it">
                  Outdated
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              ) : (
                <span className="freshness outdated" title="A newer crawl of this site exists">Outdated</span>
              )
            )}
          </div>
        </div>
        <div className="row report-actions">
          <button className="icon-btn" onClick={() => setPaletteOpen(true)} title="Search (⌘K)" aria-label="Search">
            <Search size={16} />
          </button>
          <ExportMenu onExport={download} />
          {sharing ? (
            <ShareControl sharing={sharing} />
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={share} title={isTauri() ? "Save a shareable HTML report" : "Available in the desktop app"}><IconShare size={15} /> Share</button>
          )}
          <button className="btn btn-primary btn-sm" onClick={onReset}><IconRefresh size={15} /> Recrawl</button>
        </div>
          </div>

          <div className="tabs">
            <Tabish id="overview" tab={tab} set={setTab}>Overview</Tabish>
            <Tabish id="issues" tab={tab} set={setTab} count={issueCount}>Issues</Tabish>
            <Tabish id="pages" tab={tab} set={setTab} count={pageRows.length}>Pages</Tabish>
            {result.linkGraph && result.linkGraph.nodes.length > 0 && (
              <Tabish id="graph" tab={tab} set={setTab}>Link graph</Tabish>
            )}
            {extraTabs?.map((t) => (
              <Tabish key={t.id} id={t.id} tab={tab} set={setTab} count={t.count}>{t.label}</Tabish>
            ))}
          </div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}

      <div className={`report-body${tab === "pages" || tab === "graph" ? " wide fill" : extraTabs?.find((t) => t.id === tab)?.wide ? " wide" : ""}`}>
      {tab === "overview" && <Overview result={result} onCategory={goCategory} onSeverity={goSeverity} onStatus={goStatus} onDepth={goDepth} />}
      {tab === "issues" && (
        <Issues
          result={result}
          sevFilter={sevFilter}
          setSevFilter={setSevFilter}
          catFilter={catFilter}
          setCatFilter={setCatFilter}
          onOpenUrl={openUrl}
          focusRule={focusRule}
          onOpenIssue={onOpenIssue}
        />
      )}
      {tab === "pages" && (
        <Pages
          rows={pageRows}
          totalPages={result.pagesTruncated && !result.pageIndex?.length ? s.totalPages : undefined}
          loadingUrl={rowLoading}
          statusFilter={pageStatus}
          setStatusFilter={setPageStatus}
          depthFilter={pageDepth}
          setDepthFilter={setPageDepth}
          onOpen={(r) => void openRow(r)}
        />
      )}
      {tab === "graph" && (
        <LinkGraphView result={result} onOpenUrl={openUrl} />
      )}
      {extraTabs?.find((t) => t.id === tab)?.content}

      </div>

      {paletteEl}
    </>
  );
}

/** ⌘K command palette: fuzzy-jump to any tab, page, or issue rule, or run an
 *  action. Sources are the crawl's own data, so a 200k-page report is navigable
 *  by typing a few characters. */
function CommandPalette({
  result,
  pageRows,
  extraTabs,
  hasGraph,
  onClose,
  onTab,
  onOpenPage,
  onRule,
  onNewCrawl,
  onDownload,
}: {
  result: CrawlResult;
  pageRows: PageRow[];
  extraTabs?: ExtraTab[];
  hasGraph: boolean;
  onClose: () => void;
  onTab: (t: string) => void;
  onOpenPage: (url: string) => void;
  onRule: (rule: string) => void;
  onNewCrawl: () => void;
  onDownload: (k: "csv" | "json") => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  type Item = { id: string; kind: "tab" | "page" | "issue" | "action"; label: string; hint?: string; run: () => void };

  // Static commands (tabs + actions) — always available.
  const staticItems: Item[] = useMemo(() => {
    const tabs: Item[] = [
      { id: "t:overview", kind: "tab", label: "Overview", hint: "tab", run: () => onTab("overview") },
      { id: "t:issues", kind: "tab", label: "Issues", hint: "tab", run: () => onTab("issues") },
      { id: "t:pages", kind: "tab", label: "Pages", hint: "tab", run: () => onTab("pages") },
    ];
    if (hasGraph) tabs.push({ id: "t:graph", kind: "tab", label: "Link graph", hint: "tab", run: () => onTab("graph") });
    for (const t of extraTabs ?? []) tabs.push({ id: `t:${t.id}`, kind: "tab", label: t.label, hint: "tab", run: () => onTab(t.id) });
    const actions: Item[] = [
      { id: "a:new", kind: "action", label: "New crawl", hint: "action", run: onNewCrawl },
      { id: "a:csv", kind: "action", label: "Download issues CSV", hint: "action", run: () => onDownload("csv") },
      { id: "a:json", kind: "action", label: "Download report JSON", hint: "action", run: () => onDownload("json") },
    ];
    return [...tabs, ...actions];
  }, [extraTabs, hasGraph, onTab, onNewCrawl, onDownload]);

  // Issue rules, with exact counts from the rollup when present.
  const issueItems: Item[] = useMemo(() => {
    const counts = new Map<string, number>();
    const titles = new Map<string, string>();
    for (const g of result.issueRollup ?? []) { counts.set(g.rule, g.count); titles.set(g.rule, g.title); }
    if (!counts.size) {
      for (const i of result.issues) {
        if (i.severity === "good") continue;
        counts.set(i.rule, (counts.get(i.rule) ?? 0) + 1);
        titles.set(i.rule, i.title);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([rule, count]) => ({ id: `i:${rule}`, kind: "issue" as const, label: titles.get(rule) ?? rule, hint: `${num(count)} issue${count === 1 ? "" : "s"}`, run: () => onRule(rule) }));
  }, [result, onRule]);

  const results: Item[] = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) {
      // Empty query: tabs + actions + top issues (no page dump).
      return [...staticItems, ...issueItems.slice(0, 6)];
    }
    const score = (label: string, extra = ""): number => {
      const hay = (label + " " + extra).toLowerCase();
      const idx = hay.indexOf(needle);
      if (idx === -1) return -1;
      return 1000 - idx - Math.abs(hay.length - needle.length) * 0.1;
    };
    const scored: Array<{ item: Item; s: number }> = [];
    for (const it of [...staticItems, ...issueItems]) {
      const sc = score(it.label);
      if (sc >= 0) scored.push({ item: it, s: sc });
    }
    // Pages: search URL + title, cap results so huge crawls stay instant.
    let pageHits = 0;
    for (const r of pageRows) {
      if (pageHits >= 40) break;
      const sc = score(r.url, r.title ?? "");
      if (sc >= 0) {
        scored.push({ item: { id: `p:${r.url}`, kind: "page", label: shortUrl(r.url), hint: r.title ?? undefined, run: () => onOpenPage(r.url) }, s: sc });
        pageHits++;
      }
    }
    return scored.sort((a, b) => b.s - a.s).slice(0, 40).map((x) => x.item);
  }, [q, staticItems, issueItems, pageRows, onOpenPage]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (it?: Item) => { if (it) { it.run(); onClose(); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(results[active]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  const kindLabel: Record<Item["kind"], string> = { tab: "Tab", page: "Page", issue: "Issue", action: "Action" };

  return (
    <div className="cmdk-backdrop" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="cmdk-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Jump to a page, issue, tab, or action…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
          <kbd className="cmdk-kbd">esc</kbd>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {results.length === 0 ? (
            <div className="cmdk-empty">No matches for “{q}”.</div>
          ) : (
            results.map((it, i) => (
              <button
                key={it.id}
                data-idx={i}
                className={`cmdk-item${i === active ? " active" : ""}`}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(it)}
              >
                <span className={`cmdk-kind cmdk-kind-${it.kind}`}>{kindLabel[it.kind]}</span>
                <span className="cmdk-label">{it.label}</span>
                {it.hint && <span className="cmdk-item-hint">{it.hint}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** Share button + popover: create/copy/revoke the public link in place. A
 *  green dot on the button means a link is live. */
function ShareControl({ sharing }: { sharing: Sharing }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Fixed-position under the button: the popover escapes the report bar's
  // overflow clipping and can be clamped to the viewport at narrow widths.
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) });
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onAway = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onAway);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onAway);
    };
  }, [open]);

  const copy = (url: string) => {
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div ref={ref} className="share-wrap">
      <button className="btn btn-secondary btn-sm" onClick={toggle} aria-haspopup="dialog" aria-expanded={open}>
        <IconShare size={15} /> Share
        {sharing.url && <span className="share-dot" title="Public link is live" aria-label="Public link is live" />}
      </button>
      {open && (
        <div className="share-pop" style={{ top: pos.top, right: pos.right }} role="dialog" aria-label="Share report">
          <div className="share-pop-title">Share report</div>
          {sharing.url ? (
            <>
              <div className="share-pop-hint">Anyone with this link can view the report. No sign-in needed.</div>
              <div className="share-linkrow">
                <code className="share-link mono" title={sharing.url}>{sharing.url.replace(/^https?:\/\//, "")}</code>
                <button className="btn btn-sm btn-secondary" onClick={() => copy(sharing.url!)}>{copied ? "Copied!" : "Copy"}</button>
              </div>
              <div className="share-pop-sep" />
              <div className="share-pop-foot">
                <span className="share-pop-hint" style={{ margin: 0 }}>Revoking breaks the link immediately.</span>
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await sharing.onUnshare();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Make private
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="share-pop-hint">Create a public link anyone can open — scores, issues and pages, no sign-in needed.</div>
              <button
                className="btn btn-primary btn-sm"
                style={{ width: "100%", justifyContent: "center" }}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    copy(await sharing.onShare());
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Creating…" : "Create public link"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
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
  // bar shows the *mix*, not just a total. Lean reports aggregate from the
  // rollup (exact counts) instead of the capped issue sample.
  const catRows = useMemo(() => {
    const m = new Map<Category, { error: number; warning: number; notice: number }>();
    if (result.issueRollup?.length) {
      for (const g of result.issueRollup) {
        if (g.severity === "good") continue;
        const e = m.get(g.category) ?? { error: 0, warning: 0, notice: 0 };
        e[g.severity as "error" | "warning" | "notice"] += g.count;
        m.set(g.category, e);
      }
    } else {
      for (const i of result.issues) {
        if (i.severity === "good") continue;
        const e = m.get(i.category) ?? { error: 0, warning: 0, notice: 0 };
        e[i.severity as "error" | "warning" | "notice"]++;
        m.set(i.category, e);
      }
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
  }, [result.issues, result.issueRollup]);

  const fixes = result.issueRollup?.length
    ? topFixesFromRollup(result.issueRollup, 5)
    : topFixes(result.issues, 5);
  const sitemapFound = result.sitemapFound ?? result.sitemapUrls > 0;

  return (
    <div className="section-gap">
      <div className="crawl-meta">
        {result.startedAt && <span className="crawl-meta-item">Crawled {fmtWhen(result.startedAt)}</span>}
        <span className="crawl-meta-item">{num(s.totalPages)} pages</span>
        <span className="crawl-meta-item">{ms(s.durationMs)}</span>
        <span className={`crawl-meta-item crawl-meta-flag ${result.robotsFound ? "on" : "off"}`}>robots.txt</span>
        <span className={`crawl-meta-item crawl-meta-flag ${sitemapFound ? "on" : "off"}`}>
          {result.sitemapUrls > 0
            ? `${num(result.sitemapUrls)} sitemap URLs`
            : sitemapFound
              ? "sitemap"
              : "no sitemap"}
        </span>
        <span className={`crawl-meta-item crawl-meta-flag ${result.llmsTxtFound ? "on" : "off"}`}>llms.txt</span>
      </div>
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

      <div className="overview-cols">
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

      <div className="overview-half">
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
  focusRule,
  onOpenIssue,
}: {
  result: CrawlResult;
  sevFilter: Severity | "all";
  setSevFilter: (s: Severity | "all") => void;
  catFilter: Category | null;
  setCatFilter: (c: Category | null) => void;
  onOpenUrl: (u: string) => void;
  /** A rule to auto-expand and scroll to (deep link / command palette). */
  focusRule?: string | null;
  onOpenIssue?: (rule: string) => void;
}) {
  const problems = result.issues.filter((i) => i.severity !== "good");
  // Lean reports: `issues` holds per-rule samples; the rollup has exact counts.
  const trueCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of result.issueRollup ?? []) m.set(g.rule, g.count);
    return m;
  }, [result.issueRollup]);
  const allCount = result.issuesTruncated
    ? result.summary.errors + result.summary.warnings + result.summary.notices
    : problems.length;

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
    return [...map.values()].sort(
      (a, b) =>
        severityRank(b.severity) - severityRank(a.severity) ||
        (trueCounts.get(b.rule) ?? b.items.length) - (trueCounts.get(a.rule) ?? a.items.length)
    );
  }, [result.issues, sevFilter, catFilter, trueCounts]);

  return (
    <div className="section-gap">
      <div className="row between wrap" style={{ gap: "var(--sp-2)" }}>
        <div className="row wrap">
          <FilterChip active={sevFilter === "all"} onClick={() => setSevFilter("all")}>All <span className="mono">{num(allCount)}</span></FilterChip>
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
        <div>{groups.map((g) => <IssueGroup key={g.rule} group={g} trueCount={trueCounts.get(g.rule)} totalPages={result.summary.totalPages} onOpenUrl={onOpenUrl} brokenLinks={result.brokenLinks} focus={g.rule === focusRule} onOpenIssue={onOpenIssue} />)}</div>
      )}
    </div>
  );
}

/** Target-centric rows for the broken-link drill-in. Prefer the exact
 *  crawl-time aggregation; older reports fall back to aggregating the
 *  (possibly sampled) inline issues. */
/** Export split-button: one visible trigger, a small CSV/JSON menu. Collapses
 *  two download buttons into one, keeping the action row uncluttered. */
function ExportMenu({ onExport }: { onExport: (fmt: "csv" | "json") => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const pick = (fmt: "csv" | "json") => { onExport(fmt); setOpen(false); };
  return (
    <div ref={ref} className="export-menu">
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title="Export report">
        <IconDownload size={15} /> Export
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 3, opacity: 0.7 }}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="export-pop" role="menu">
          <button role="menuitem" className="export-item" onClick={() => pick("csv")}>CSV</button>
          <button role="menuitem" className="export-item" onClick={() => pick("json")}>JSON</button>
        </div>
      )}
    </div>
  );
}

function brokenLinkRows(brokenLinks: BrokenLink[] | undefined, items: Issue[]): { rows: BrokenLink[]; exact: boolean } {
  if (brokenLinks?.length) return { rows: brokenLinks, exact: true };
  const map = new Map<string, BrokenLink>();
  for (const i of items) {
    const m = /^(\S+) → (.+)$/.exec(i.detail ?? "");
    if (!m) continue;
    let e = map.get(m[2]);
    if (!e) {
      e = { url: m[2], status: m[1] === "ERR" ? 0 : Number(m[1]) || 0, count: 0, sources: [] };
      map.set(m[2], e);
    }
    e.count += 1;
    if (!e.sources.includes(i.url)) e.sources.push(i.url);
  }
  const rows = [...map.values()].sort((a, b) => b.count - a.count || a.url.localeCompare(b.url));
  return { rows, exact: false };
}

function IssueGroup({ group, trueCount, totalPages, onOpenUrl, brokenLinks, focus, onOpenIssue }: { group: { rule: string; title: string; severity: Severity; category: Issue["category"]; items: Issue[] }; trueCount?: number; totalPages: number; onOpenUrl: (u: string) => void; brokenLinks?: BrokenLink[]; focus?: boolean; onOpenIssue?: (rule: string) => void }) {
  const [open, setOpen] = useState(!!focus);
  const headRef = useRef<HTMLButtonElement>(null);
  // Deep-linked / palette-focused group: open it and scroll it into view once.
  useEffect(() => {
    if (focus) {
      setOpen(true);
      headRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [focus]);
  const info = ruleInfo(group.rule);
  const count = trueCount ?? group.items.length;
  // Sitebulb-style coverage: how much of the crawl this rule touches. On lean
  // reports the items are a sample, so coverage comes from the exact count.
  const sampleAffected = useMemo(() => new Set(group.items.map((i) => i.url)).size, [group.items]);
  const affected = trueCount !== undefined && trueCount > group.items.length ? trueCount : sampleAffected;
  const coverage = totalPages > 0 ? Math.min(100, Math.round((affected / totalPages) * 100)) : 0;
  return (
    <div className={`issue-group${focus ? " focus" : ""}`}>
      <button ref={headRef} className={`issue-head ${open ? "open" : ""}`} onClick={() => setOpen(!open)}>
        <span className="chev"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg></span>
        <SeverityBadge severity={group.severity} />
        <span className="title grow">{group.title}</span>
        {coverage > 0 && (
          <span className="mono tertiary" style={{ fontSize: 12 }} title={`${affected} of ${totalPages} crawled URLs`}>
            {coverage}% of URLs
          </span>
        )}
        <span className="cat-pill">{CATEGORY_LABELS[group.category]}</span>
        <span className="mono muted">{num(count)}</span>
        {onOpenIssue && (
          <span
            className="issue-open"
            role="button"
            tabIndex={0}
            title="View this issue on its own page"
            aria-label={`View ${group.title} details`}
            onClick={(e) => { e.stopPropagation(); onOpenIssue(group.rule); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onOpenIssue(group.rule); } }}
          >
            View details
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7" /><path d="M7 7h10v10" /></svg>
          </span>
        )}
      </button>
      {open && (
        <div className="issue-body">
          {info && (
            <div className="edu">
              <div className="col"><b>Why it matters</b><p>{info.why}</p></div>
              <div className="col"><b>How to fix</b><p>{info.howToFix}</p></div>
              <div className="col"><b>If ignored</b><p>{info.impact}</p></div>
            </div>
          )}
          {group.rule === "broken-link" ? (
            <BrokenLinksTable {...brokenLinkRows(brokenLinks, group.items)} trueCount={count} onOpenUrl={onOpenUrl} />
          ) : (
            <div className="issue-urls">
              {group.items.slice(0, 200).map((i, idx) => (
                <div className="issue-url" key={idx} onClick={() => onOpenUrl(i.url)} style={{ cursor: "pointer" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortUrl(i.url)}</span>
                  {i.detail && <span className="detail">{i.detail}</span>}
                </div>
              ))}
              {count > Math.min(group.items.length, 200) &&
                (onOpenIssue ? (
                  <button className="issue-url issue-more" onClick={() => onOpenIssue(group.rule)}>
                    View all {num(count)} affected URLs
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </button>
                ) : (
                  <div className="issue-url tertiary">+ {num(count - Math.min(group.items.length, 200))} more{trueCount !== undefined && trueCount > group.items.length ? " (showing a sample)" : ""}</div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The broken-link drill-in: one row per dead target, occurrence count, and
 *  an expandable list of the pages that link to it (the culprits to fix). */
function BrokenLinksTable({ rows, exact, trueCount, onOpenUrl }: { rows: BrokenLink[]; exact: boolean; trueCount: number; onOpenUrl: (u: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = rows.slice(0, 500);
  const occurrences = rows.reduce((n, r) => n + r.count, 0);
  return (
    <div className="bl-wrap">
      <div className="bl-summary tertiary">
        {num(rows.length)} unique broken URL{rows.length === 1 ? "" : "s"} · {num(exact ? occurrences : trueCount)} occurrence{(exact ? occurrences : trueCount) === 1 ? "" : "s"}
        {!exact && trueCount > occurrences && " (aggregated from a sample — re-crawl for the full list)"}
      </div>
      <div className="bl-row bl-head" aria-hidden="true">
        <span>Status</span>
        <span>Broken URL</span>
        <span className="bl-num">Uses</span>
        <span className="bl-num">Pages</span>
        <span />
      </div>
      {shown.map((r) => (
        <div key={r.url}>
          <button className={`bl-row${open === r.url ? " open" : ""}`} onClick={() => setOpen(open === r.url ? null : r.url)}>
            <StatusPill status={r.status} />
            <span className="bl-url mono" title={r.url}>{r.url}</span>
            <span className="bl-num mono">{num(r.count)}</span>
            <span className="bl-num mono">{num(r.sources.length)}{r.sourcesTruncated ? "+" : ""}</span>
            <span className="chev"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg></span>
          </button>
          {open === r.url && (
            <div className="bl-sources">
              <div className="bl-sources-head">
                <span className="tertiary">Linked from{r.sourcesTruncated ? ` (first ${r.sources.length} pages)` : ""}:</span>
                <button className="linklike" onClick={() => openExternal(r.url)} style={{ fontSize: 12 }}>Open target <IconExternal size={11} /></button>
              </div>
              {r.sources.map((s) => (
                <div className="issue-url" key={s} onClick={() => onOpenUrl(s)} style={{ cursor: "pointer" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortUrl(s)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {rows.length > shown.length && (
        <div className="issue-url tertiary">+ {num(rows.length - shown.length)} more broken URLs</div>
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
type SortKey = "url" | "status" | "depth" | "wordCount" | "inlinks" | "linkScore" | "seoScore" | "geoScore";

// Windowed rendering: rows are fixed-height so only the visible slice (plus
// overscan) exists in the DOM — a 200k-row crawl scrolls like a 30-row one.
const ROW_H = 45;
const OVERSCAN = 12;

function Pages({
  rows,
  totalPages,
  loadingUrl,
  statusFilter,
  setStatusFilter,
  depthFilter,
  setDepthFilter,
  onOpen,
}: {
  rows: PageRow[];
  /** True crawl size when `rows` is a partial list (no index available). */
  totalPages?: number;
  /** URL whose full record is currently being fetched (row shows busy). */
  loadingUrl?: string | null;
  statusFilter: number | null;
  setStatusFilter: (s: number | null) => void;
  depthFilter: number | null;
  setDepthFilter: (d: number | null) => void;
  onOpen: (r: PageRow) => void;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("depth");
  const [dir, setDir] = useState<1 | -1>(1);

  const visible = useMemo(() => {
    const needle = q.toLowerCase();
    const f = rows.filter(
      (r) =>
        r.url.toLowerCase().includes(needle) &&
        (statusFilter === null || r.status === statusFilter) &&
        (depthFilter === null || r.depth === depthFilter)
    );
    const val = (r: PageRow): number | string =>
      sort === "url" ? r.url : ((r[sort] as number | undefined) ?? 0);
    return f.sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * dir;
      return (av - bv) * dir;
    });
  }, [rows, q, sort, dir, statusFilter, depthFilter]);

  // --- Virtual window over `visible` ---
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  // Jump back to the top whenever the row set changes shape.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [q, sort, dir, statusFilter, depthFilter]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(visible.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  const slice = visible.slice(start, end);

  // Fill the viewport instead of guessing an offset: measure where the table
  // actually starts (host top bars differ between desktop and cloud) and take
  // everything below it — but never taller than the rows themselves.
  const [availH, setAvailH] = useState<number>();
  useEffect(() => {
    const measure = () => {
      const top = scrollRef.current?.getBoundingClientRect().top ?? 0;
      setAvailH(Math.max(320, window.innerHeight - top - 24));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const contentH = visible.length * ROW_H + 44; // rows + sticky header
  const tableH = availH === undefined ? undefined : Math.min(availH, Math.max(320, contentH));

  const sticky: React.CSSProperties = { position: "sticky", top: 0, zIndex: 2, background: "var(--panel, var(--bg))" };
  function th(key: SortKey, label: string, align?: "right") {
    const active = sort === key;
    return (
      <th
        onClick={() => (active ? setDir((d) => (d === 1 ? -1 : 1)) : (setSort(key), setDir(1)))}
        style={{ textAlign: align, ...sticky }}
      >
        {label}
        {active && <span className="arrow">{dir === 1 ? "↑" : "↓"}</span>}
      </th>
    );
  }

  const cellClip: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

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
        <span className="tertiary mono" style={{ fontSize: 12, alignSelf: "center" }}>{num(visible.length)} pages</span>
      </div>
      {totalPages !== undefined && totalPages > rows.length && (
        <div className="card card-pad" style={{ padding: "10px 14px", font: "var(--copy-13)", color: "var(--text-secondary)" }}>
          Browsing the first {num(rows.length)} of {num(totalPages)} crawled pages. Scores, issues and charts
          reflect the <b>full crawl</b>.
        </div>
      )}
      <div
        className="table-wrap"
        ref={scrollRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        style={{ height: tableH, maxHeight: availH, minHeight: 320, overflow: "auto" }}
      >
        <table className="data-grid">
          <thead>
            <tr>
              {th("url", "URL")}
              {th("status", "Status")}
              <th style={sticky}>Title</th>
              {th("depth", "Depth", "right")}
              {th("wordCount", "Words", "right")}
              {th("inlinks", "Inlinks", "right")}
              {th("linkScore", "Link", "right")}
              {th("seoScore", "SEO", "right")}
              {th("geoScore", "GEO", "right")}
              <th style={sticky}>Indexable</th>
            </tr>
          </thead>
          <tbody>
            {start > 0 && (
              <tr aria-hidden style={{ height: start * ROW_H }}>
                <td colSpan={10} style={{ padding: 0, border: 0 }} />
              </tr>
            )}
            {slice.map((r) => (
              <tr
                key={r.url}
                onClick={() => onOpen(r)}
                style={{ height: ROW_H, opacity: loadingUrl && loadingUrl === r.url ? 0.5 : undefined }}
              >
                <td><div className="cell-url" title={r.url}>{shortUrl(r.url)}</div></td>
                <td><StatusPill status={r.status} /></td>
                <td style={{ maxWidth: 240, ...cellClip }} title={r.title ?? ""}>
                  {r.title ?? <span className="tertiary">—</span>}
                </td>
                <td className="num">{r.depth}</td>
                <td className="num">{num(r.wordCount)}</td>
                <td className="num">{r.inlinks}</td>
                <td className="num">{r.linkScore !== undefined ? Math.round(r.linkScore) : "—"}</td>
                <td className="num" style={{ color: r.status === 200 ? scoreColor(r.seoScore) : "var(--text-tertiary)" }}>
                  {r.status === 200 ? r.seoScore : "—"}
                </td>
                <td className="num" style={{ color: r.status === 200 ? scoreColor(r.geoScore) : "var(--text-tertiary)" }}>
                  {r.status === 200 ? r.geoScore : "—"}
                </td>
                <td>{r.indexable ? <span className="badge badge-ok"><span className="dot" />Yes</span> : <span className="badge badge-neutral" title={r.indexability ?? ""}>{r.indexability ?? "No"}</span>}</td>
              </tr>
            ))}
            {end < visible.length && (
              <tr aria-hidden style={{ height: (visible.length - end) * ROW_H }}>
                <td colSpan={10} style={{ padding: 0, border: 0 }} />
              </tr>
            )}
            {visible.length === 0 && <tr><td colSpan={10}><Empty>No pages match.</Empty></td></tr>}
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
  onSearch,
  activeSection,
  onSectionChange,
  sections,
  pageCrumb,
}: {
  page: Page;
  issues: Issue[];
  reportName: string;
  crumb: string;
  onBack: () => void;
  onReports: () => void;
  onSearch?: () => void;
  activeSection: string;
  onSectionChange: (section: string) => void;
  sections: PageDetailSection[];
  pageCrumb?: { label: string; onClick: () => void };
}) {
  const problems = issues
    .filter((i) => i.severity !== "good")
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const navigation = [
    { id: "overview", label: "Summary" },
    ...sections.map(({ id, label }) => ({ id, label })),
    { id: "content", label: "Content & AI" },
    { id: "technical", label: "Technical" },
    { id: "raw", label: "Raw data" },
  ];
  const section = navigation.some((item) => item.id === activeSection) ? activeSection : "overview";
  return (
    <>
      <div className="report-bar">
        <div className="report-bar-inner crumbs-only" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <nav className="crumbs" style={{ flex: 1, minWidth: 0 }} data-tauri-drag-region>
            {pageCrumb ? (
              <button className="crumb-link" onClick={pageCrumb.onClick}>{pageCrumb.label}</button>
            ) : (
              <>
                <button className="crumb-link" onClick={onReports}>Reports</button>
                <span className="crumb-sep">/</span>
                <button className="crumb-link" onClick={onBack}>{reportName}</button>
                <span className="crumb-sep">/</span>
                <button className="crumb-link" onClick={onBack}>{crumb}</button>
              </>
            )}
            <span className="crumb-sep">/</span>
            <span className="crumb-current mono">{shortUrl(page.url)}</span>
          </nav>
          {onSearch && (
            <button className="cmdk-hint" onClick={onSearch} title="Search (⌘K)" aria-label="Search" style={{ flex: "0 0 auto" }}>
              <Search size={14} /> <kbd className="cmdk-kbd">⌘K</kbd>
            </button>
          )}
        </div>
      </div>
      <div className="report-body">
        <div className="content360-page">
          <header className="content360-hero">
            <div className="row between wrap" style={{ gap: "var(--sp-3)", alignItems: "flex-start" }}>
              <div className="col" style={{ gap: 9, minWidth: 0 }}>
              <h1 style={{ margin: 0, font: "var(--heading-24)", letterSpacing: "-0.01em" }}>{page.title ?? shortUrl(page.url)}</h1>
                <span className="content360-url">{page.url}</span>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => openExternal(page.finalUrl)} style={{ flex: "0 0 auto" }}>
                <IconExternal size={15} /> Open URL
              </button>
            </div>
          </header>

          <nav className="content360-nav" aria-label="Page detail sections">
            {navigation.map((item) => (
              <button key={item.id} className={section === item.id ? "on" : ""} aria-current={section === item.id ? "page" : undefined} onClick={() => onSectionChange(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="content360-section">
            {section === "overview" && <Content360Overview page={page} problems={problems} onSectionChange={onSectionChange} />}
            {sections.map((item) => section === item.id ? <div key={item.id}>{item.content}</div> : null)}
            {section === "content" && page.status === 200 && (
              <div className="content360-stack">
                <SectionIntro eyebrow="How this page presents" title="Content & AI" copy="Review the page as search engines, social platforms, and answer engines understand it." />
                <SerpPreview page={page} />
                <SocialPreview page={page} />
                <GeoCard geo={page.geo} />
              </div>
            )}
            {section === "content" && page.status !== 200 && <ContentUnavailable status={page.status} />}
            {section === "technical" && <TechnicalDetails page={page} />}
            {section === "raw" && <RawPageData page={page} issues={issues} />}
          </div>
        </div>
      </div>
    </>
  );
}

type ReadinessTone = "good" | "warn" | "bad";

interface PageVerdict {
  tone: ReadinessTone;
  label: string;
  title: string;
  summary: string;
}

interface ReadinessSignal {
  label: string;
  value: string;
  detail: string;
  tone: ReadinessTone;
}

function pageVerdict(page: Page, problems: Issue[]): PageVerdict {
  const critical = problems.filter((issue) => issue.severity === "error").length;
  const warnings = problems.filter((issue) => issue.severity === "warning").length;
  if (page.status !== 200) {
    return {
      tone: "bad",
      label: "Response blocker",
      title: `The page is unavailable to search engines`,
      summary: `The final URL returned HTTP ${page.status}. Restore a successful response before spending time on copy, schema, or search optimisation.`,
    };
  }
  if (!page.indexable) {
    const reason = page.indexability?.trim() || (page.canonicalized ? "its canonical points to another URL" : "an indexing directive blocks it");
    return {
      tone: "bad",
      label: page.canonicalized ? "Consolidated elsewhere" : "Indexing blocker",
      title: page.canonicalized ? "This URL is not the canonical page" : "This page cannot enter search results",
      summary: `The page loads, but ${reason.toLowerCase()}. Confirm that this is intentional before optimising anything downstream.`,
    };
  }
  if (critical > 0) {
    return {
      tone: "bad",
      label: "Critical attention",
      title: `${critical} critical ${critical === 1 ? "issue needs" : "issues need"} resolving`,
      summary: "The page is crawlable and indexable, but the highest-impact crawl findings should be resolved before treating it as launch-ready.",
    };
  }
  if (warnings > 0) {
    return {
      tone: "warn",
      label: "Ready with gaps",
      title: `The page works, with ${warnings} worthwhile ${warnings === 1 ? "improvement" : "improvements"}`,
      summary: "Nothing currently blocks indexing. The recommended action below is the clearest next move to improve how this page is understood or discovered.",
    };
  }
  return {
    tone: "good",
    label: "Technically ready",
    title: "No crawl blocker is holding this page back",
    summary: problems.length
      ? "Only minor observations remain. Use Discoverability and History to decide whether the next move is content, distribution, or simply more time."
      : "The crawl evidence is clean. Use Discoverability and History next to see whether the page is earning impressions and clicks.",
  };
}

function pageReadiness(page: Page): ReadinessSignal[] {
  const available = page.status === 200;
  const internallyReachable = page.depth === 0 || page.inlinks > 0;
  const reachTone: ReadinessTone = !internallyReachable ? "bad" : page.depth <= 3 ? "good" : "warn";
  const scoreSignal = (label: string, score: number): ReadinessSignal => ({
    label,
    value: available ? `${Math.round(score)}/100` : "Unavailable",
    detail: available ? (score >= 80 ? "Strong crawl signals" : score >= 50 ? "Some gaps remain" : "Needs focused work") : "Fix the response first",
    tone: available ? (score >= 80 ? "good" : score >= 50 ? "warn" : "bad") : "bad",
  });
  return [
    {
      label: "Available",
      value: `HTTP ${page.status}`,
      detail: available ? `${ms(page.responseTimeMs)} response` : "Successful response required",
      tone: available ? "good" : "bad",
    },
    {
      label: "Indexable",
      value: available && page.indexable ? "Allowed" : "Blocked",
      detail: page.indexable ? "No indexing block found" : page.indexability || (page.canonicalized ? "Canonicalised elsewhere" : "Review directives"),
      tone: available && page.indexable ? "good" : "bad",
    },
    {
      label: "Internally found",
      value: page.depth === 0 ? "Root URL" : `${num(page.inlinks)} inlinks`,
      detail: !internallyReachable ? "No internal path found" : `Crawl depth ${page.depth}`,
      tone: reachTone,
    },
    scoreSignal("Search setup", page.seoScore),
    scoreSignal("Answer readiness", page.geo.score),
  ];
}

const CONTENT_CATEGORIES = new Set<Category>(["titles-meta", "headings", "content", "images", "social", "structured-data", "geo"]);

function issueEvidenceSection(issue: Issue): "content" | "technical" {
  return CONTENT_CATEGORIES.has(issue.category) ? "content" : "technical";
}

function Content360Overview({ page, problems, onSectionChange }: { page: Page; problems: Issue[]; onSectionChange: (section: string) => void }) {
  const critical = problems.filter((issue) => issue.severity === "error").length;
  const readability = typeof page.readability === "number" ? `${Math.round(page.readability)} · ${fleschLabel(page.readability)}` : "Not measured";
  const verdict = pageVerdict(page, problems);
  const readiness = pageReadiness(page);
  const strongSignals = readiness.filter((signal) => signal.tone === "good").length;
  const primary = problems[0];
  const primaryInfo = primary ? ruleInfo(primary.rule) : undefined;
  const evidenceSection = primary ? issueEvidenceSection(primary) : "technical";
  return (
    <div className="content360-overview">
      <section className={`content360-assessment ${verdict.tone}`}>
        <div className="content360-assessment-copy">
          <div className="content360-verdict-label"><span aria-hidden="true" />{verdict.label}</div>
          <h2>{verdict.title}</h2>
          <p>{verdict.summary}</p>
        </div>
        <dl className="content360-assessment-evidence">
          <div><dt>Response</dt><dd>HTTP {page.status}</dd><small>{ms(page.responseTimeMs)}</small></div>
          <div><dt>Indexing</dt><dd>{page.indexable ? "Allowed" : "Blocked"}</dd><small>{page.canonicalized ? "canonical elsewhere" : page.indexable ? "directives clear" : "review directives"}</small></div>
          <div><dt>Internal reach</dt><dd>{page.depth === 0 ? "Root URL" : `${num(page.inlinks)} inlinks`}</dd><small>depth {page.depth}</small></div>
          <div><dt>Findings</dt><dd>{problems.length ? `${problems.length} open` : "All clear"}</dd><small>{critical ? `${critical} critical` : problems.length ? "prioritised below" : "this crawl"}</small></div>
        </dl>
      </section>

      <section className="content360-readiness">
        <div className="content360-section-head">
          <div><span className="content360-eyebrow">From publish to discoverability</span><h3>Readiness path</h3></div>
          <span>{strongSignals} of {readiness.length} strong</span>
        </div>
        <ol className="content360-readiness-list">
          {readiness.map((signal, index) => (
            <li className={signal.tone} key={signal.label}>
              <div className="content360-readiness-top">
                <span className="content360-readiness-step">{index + 1}</span>
                <span className="content360-readiness-mark" aria-hidden="true">{signal.tone === "good" ? <Check size={12} /> : signal.tone === "warn" ? "!" : "×"}</span>
              </div>
              <span>{signal.label}</span>
              <b>{signal.value}</b>
              <small>{signal.detail}</small>
            </li>
          ))}
        </ol>
      </section>

      {primary ? (
        <section className={`content360-next-action tone-${primary.severity}`}>
          <div className="content360-next-action-main">
            <span className="content360-eyebrow">Next best action</span>
            <div className="content360-next-action-title"><SeverityBadge severity={primary.severity} /><h3>{primary.title}</h3></div>
            <p>{primary.detail || primaryInfo?.why || "Resolve this finding, then crawl the page again to confirm the result."}</p>
            <button className="btn btn-secondary btn-sm" onClick={() => onSectionChange(evidenceSection)}>
              Review {evidenceSection === "content" ? "content" : "technical"} evidence <ArrowRight size={14} />
            </button>
          </div>
          <div className="content360-next-action-fix">
            <span className="content360-eyebrow">How to resolve it</span>
            <p>{primaryInfo?.howToFix || "Inspect the captured evidence, correct the source page, and verify the change with a fresh crawl."}</p>
            {primaryInfo?.impact && <><span className="content360-eyebrow">Why this comes first</span><p>{primaryInfo.impact}</p></>}
          </div>
        </section>
      ) : (
        <section className="content360-clear content360-clear-standalone"><span><Check size={14} /></span><div><b>No crawl issue needs action</b><small>Check Discoverability for demand, then History for regressions or recent changes.</small></div></section>
      )}

      {problems.length > 1 && (
        <details className="content360-all-findings">
          <summary>All crawl findings <span>{problems.length}</span></summary>
          <div>
            {problems.map((issue, index) => (
              <div className="content360-priority" key={`${issue.rule}-${index}`}>
                <span className="content360-priority-rank">{index + 1}</span>
                <SeverityBadge severity={issue.severity} />
                <div><b>{issue.title}</b>{issue.detail && <small>{issue.detail}</small>}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      <section className="content360-facts">
        <div><span className="content360-eyebrow">Content</span><h3>{num(page.wordCount)} words</h3><p>{page.h1.length || 0} H1, {page.h2Count} H2, {page.h3Count} H3 · readability {readability}</p></div>
        <div><span className="content360-eyebrow">Structure</span><h3>{page.inlinks} incoming links</h3><p>Depth {page.depth} · link score {Math.round(page.linkScore)}/100 · {page.internalLinks.length} outgoing internal links</p></div>
        <div><span className="content360-eyebrow">Delivery</span><h3>{ms(page.responseTimeMs)}</h3><p>{bytes(page.sizeBytes)} transferred · {page.contentEncoding ?? "no compression"}</p></div>
      </section>
    </div>
  );
}

function RawPageData({ page, issues }: { page: Page; issues: Issue[] }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const payload = useMemo(() => ({ page, issues }), [page, issues]);
  const json = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(json);
      setCopyState("copied");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = json;
      textarea.setAttribute("readonly", "");
      textarea.style.cssText = "position:fixed;inset:0 auto auto -9999px;opacity:0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      setCopyState(copied ? "copied" : "failed");
    }
  };

  const download = () => {
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    let slug = "page";
    try {
      const parsed = new URL(page.url);
      slug = `${parsed.hostname}${parsed.pathname}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || parsed.hostname;
    } catch {
      // Keep the safe fallback for malformed historical URLs.
    }
    a.download = `crawlie-${slug}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="content360-raw">
      <div className="content360-raw-head">
        <SectionIntro eyebrow="Complete crawl record" title="Raw page data" copy="Every captured page field and page-specific issue, unchanged and ready for debugging or downstream analysis." />
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={copy}><Clipboard size={14} />{copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy JSON"}</button>
          <button className="btn btn-secondary btn-sm" onClick={download}><IconDownload size={14} />Download JSON</button>
        </div>
      </div>
      <div className="content360-raw-summary"><span>{Object.keys(page).length} page fields</span><span>{issues.length} issue records</span><span>JSON</span></div>
      <pre tabIndex={0} aria-label="Raw page data as JSON">{json}</pre>
    </div>
  );
}

function SectionIntro({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <div className="content360-intro"><span className="content360-eyebrow">{eyebrow}</span><h2>{title}</h2><p>{copy}</p></div>;
}

function ContentUnavailable({ status }: { status: number }) {
  return <div className="content360-unavailable"><CircleAlert size={20} /><div><b>Content signals are unavailable</b><span>This URL returned HTTP {status}. Resolve the response first, then crawl it again.</span></div></div>;
}

function TechnicalDetails({ page }: { page: Page }) {
  return (
    <div className="content360-technical-wrap">
      <SectionIntro eyebrow="Crawler evidence" title="Technical" copy="The response, directives, document structure, and delivery details captured in this crawl." />
      <dl className="kv content360-technical">
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
            {(page.inlinkAnchors?.length ?? 0) > 0 && (
              <Row k="Inbound anchors" v={page.inlinkAnchors!.map((a) => `“${a.text}” ×${a.count}`).join("  ·  ")} />
            )}
            <Row k="Link score" v={`${Math.round(page.linkScore)} / 100`} />
            <Row k="Response" v={`${ms(page.responseTimeMs)} · ${bytes(page.sizeBytes)}`} />
            <Row k="Compression" v={page.contentEncoding ?? "none"} />
            <Row k="HSTS" v={page.hsts ? "Yes" : "No"} />
            {page.secHeaders && (
              <Row
                k="Security headers"
                v={
                  [
                    page.secHeaders.csp && "CSP",
                    page.secHeaders.xContentTypeOptions && "X-Content-Type-Options",
                    page.secHeaders.xFrameOptions && "X-Frame-Options",
                    page.secHeaders.referrerPolicy && "Referrer-Policy",
                  ]
                    .filter(Boolean)
                    .join(", ") || "None"
                }
              />
            )}
            {typeof page.readability === "number" && (
              <Row k="Readability" v={`Flesch ${Math.round(page.readability)} (${fleschLabel(page.readability)})`} />
            )}
            {page.renderDiff && (
              <Row
                k="JS render diff"
                v={[
                  page.renderDiff.noindexRawOnly && "noindex in raw HTML only",
                  page.renderDiff.noindexRenderedOnly && "noindex injected by JS",
                  page.renderDiff.canonicalMismatch && "canonical changed by JS",
                  page.renderDiff.canonicalRenderedOnly && "canonical only after JS",
                  page.renderDiff.titleRenderedOnly ? "title only after JS" : page.renderDiff.titleModified && "title modified by JS",
                  page.renderDiff.descriptionRenderedOnly ? "description only after JS" : page.renderDiff.descriptionModified && "description modified by JS",
                  page.renderDiff.h1RenderedOnly ? "H1 only after JS" : page.renderDiff.h1Modified && "H1 modified by JS",
                  page.renderDiff.jsOnlyLinks > 0 && `${page.renderDiff.jsOnlyLinks} JS-only links`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            )}
            {page.server && <Row k="Server" v={page.server} mono />}
            <Row k="Content type" v={page.contentType ?? "—"} mono />
            {page.lang && <Row k="Language" v={page.lang} />}
            {page.hreflang.length > 0 && <Row k="hreflang" v={page.hreflang.map((h) => h.lang).join(", ")} />}
            {page.duplicateOf && <Row k="Duplicate of" v={page.duplicateOf} mono />}
            {page.redirectChain.length > 0 && <Row k="Redirects" v={page.redirectChain.map((r) => `${r.status} → ${shortUrl(r.to)}`).join("\n")} mono />}
            {page.error && <Row k="Error" v={page.error} />}
      </dl>
      {(page.headingOutline?.length ?? 0) > 0 && (
        <details className="content360-outline">
          <summary>Heading outline ({page.headingOutline!.length})</summary>
          <ol>
            {page.headingOutline!.map(([level, text], i) => (
              <li key={i} style={{ paddingLeft: (level - 1) * 16 }}>
                <span>H{level}</span>
                {text}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/* Google-style snippet mock so title/description truncation is visible at a
 * glance. Character-based approximation of Google's pixel limits. */
function SerpPreview({ page }: { page: Page }) {
  const TITLE_CHARS = 60;
  const DESC_CHARS = 155;
  const title = page.title ?? "(no title — Google will invent one)";
  const desc = page.metaDescription ?? "No meta description — Google will pick a snippet from the page text.";
  const titleCut = title.length > TITLE_CHARS;
  const descCut = desc.length > DESC_CHARS;
  const crumb = (() => {
    try {
      const u = new URL(page.url);
      const segs = u.pathname.split("/").filter(Boolean);
      return [u.host, ...segs].join(" › ");
    } catch {
      return page.url;
    }
  })();
  return (
    <div className="card card-pad col" style={{ gap: 10 }}>
      <div className="row between">
        <span className="h3">Search preview</span>
        <span className="tertiary" style={{ font: "var(--label-12)" }}>
          title {title.length}/{TITLE_CHARS} · description {desc.length}/{DESC_CHARS} chars
        </span>
      </div>
      <div style={{ maxWidth: 600, fontFamily: "arial, sans-serif" }}>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{crumb}</div>
        <div style={{ fontSize: 18, lineHeight: 1.3, color: "#3b82f6", marginBottom: 3 }}>
          {titleCut ? `${title.slice(0, TITLE_CHARS).trimEnd()}…` : title}
          {titleCut && <span title="Truncated in search results" style={{ color: "var(--amber-text)", fontSize: 12, marginLeft: 6 }}>truncated</span>}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.45, color: "var(--text-secondary)" }}>
          {descCut ? `${desc.slice(0, DESC_CHARS).trimEnd()}…` : desc}
          {descCut && <span title="Truncated in search results" style={{ color: "var(--amber-text)", fontSize: 12, marginLeft: 6 }}>truncated</span>}
        </div>
      </div>
    </div>
  );
}

/* How the page unfurls when shared on social / chat. Mocks the Open Graph card
 * (Facebook, LinkedIn, Slack, iMessage) and the X/Twitter card from the page's
 * OpenGraph + Twitter meta tags, so missing images or fallbacks are obvious. */
function SocialPreview({ page }: { page: Page }) {
  const abs = (u: string | null | undefined): string | null => {
    if (!u) return null;
    try {
      return new URL(u, page.url).href;
    } catch {
      return u;
    }
  };
  const host = hostOf(page.url);
  const img = abs(page.ogImage);
  // Platforms fall back title → og:title → <title>, and use og:description or
  // the meta description. Mirror that so the preview matches reality.
  const ogTitle = page.ogTitle ?? page.title ?? "(no title)";
  const ogDesc = page.ogDescription ?? page.metaDescription ?? "";
  // X shows a large image only for summary_large_image; otherwise a small square.
  const card = (page.twitterCard ?? "").toLowerCase();
  const large = card.includes("large") || (!card && !!img);

  const missing: string[] = [];
  if (!page.ogTitle) missing.push("og:title");
  if (!page.ogDescription) missing.push("og:description");
  if (!page.ogImage) missing.push("og:image");
  if (!page.twitterCard) missing.push("twitter:card");

  const [imgOk, setImgOk] = useState(true);
  const showImg = img && imgOk;

  const ImgOrPlaceholder = ({ h }: { h: number }) =>
    showImg ? (
      <img
        src={img!}
        alt=""
        onError={() => setImgOk(false)}
        style={{ width: "100%", height: h, objectFit: "cover", display: "block", background: "var(--bg-2)" }}
      />
    ) : (
      <div style={{ width: "100%", height: h, display: "grid", placeItems: "center", background: "var(--bg-2)", color: "var(--text-tertiary)", fontSize: 12 }}>
        {page.ogImage ? "image didn't load" : "no og:image — unfurls without a thumbnail"}
      </div>
    );

  return (
    <div className="card card-pad col" style={{ gap: 12 }}>
      <div className="row between">
        <span className="h3">Social preview</span>
        {missing.length > 0 && (
          <span className="tertiary" style={{ font: "var(--label-12)", color: "var(--amber-text)" }} title="These tags are absent; platforms fall back to weaker defaults.">
            missing {missing.join(", ")}
          </span>
        )}
      </div>
      <div className="social-grid">
        {/* Open Graph unfurl (Facebook / LinkedIn / Slack / iMessage) */}
        <div className="col" style={{ gap: 6, minWidth: 0 }}>
          <span className="tertiary" style={{ font: "var(--label-12)" }}>Open Graph · Facebook, LinkedIn, Slack</span>
          <div className="social-card">
            <ImgOrPlaceholder h={168} />
            <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-tertiary)", letterSpacing: "0.03em", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{host}</div>
              <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, marginBottom: 3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{ogTitle}</div>
              {ogDesc && <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{ogDesc}</div>}
            </div>
          </div>
        </div>
        {/* X / Twitter card */}
        <div className="col" style={{ gap: 6, minWidth: 0 }}>
          <span className="tertiary" style={{ font: "var(--label-12)" }}>X card · {card || "summary (default)"}</span>
          {large ? (
            <div className="social-card">
              <ImgOrPlaceholder h={168} />
              <div style={{ padding: "10px 12px" }}>
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{ogTitle}</div>
                {ogDesc && <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.4, marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{ogDesc}</div>}
                <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>{host}</div>
              </div>
            </div>
          ) : (
            <div className="social-card" style={{ display: "flex", alignItems: "stretch" }}>
              <div style={{ width: 84, flex: "0 0 auto", borderRight: "1px solid var(--border)" }}><ImgOrPlaceholder h={84} /></div>
              <div style={{ padding: "8px 12px", minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{ogTitle}</div>
                {ogDesc && <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.35, marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{ogDesc}</div>}
                <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 3 }}>{host}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
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
function faviconUrl(url: string, crawled?: string | null): string {
  // The crawl records the site's actual declared icon; a favicon service is
  // only the fallback for older reports (it often guesses a generic globe).
  if (crawled) return crawled;
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
function fleschLabel(f: number): string {
  if (f >= 70) return "easy";
  if (f >= 50) return "standard";
  if (f >= 30) return "difficult";
  return "very difficult";
}
function scoreColor(n: number): string {
  return n >= 80 ? "var(--green-text)" : n >= 50 ? "var(--amber-text)" : "var(--red-text)";
}
function statusColor(code: number): string {
  if (code === 0 || code >= 400) return "var(--red)";
  if (code >= 300) return "var(--amber)";
  return "var(--green)";
}
