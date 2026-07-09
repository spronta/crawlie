import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CrawlResult } from "@ui/lib/types";
import { chunkPageResolver, openExternal } from "@platform/api";
import { Logo, IconBook, IconGlobe, IconSearch, IconChevron, IconSettings, IconSpark, Spinner } from "@ui/components/ui";
import { StartView } from "@ui/views/StartView";
import { CrawlingView } from "@ui/views/CrawlingView";
import { ResultsView, type ExtraTab, type ReportViewState } from "@ui/views/ResultsView";
import { shortUrl } from "@ui/lib/format";
import { startAdhocCrawl, useAdhocCrawl, useCrawls, clearAdhocResult, resumeRunningCrawls } from "./crawls";
import { ProjectsView } from "./views/ProjectsView";
import { ProjectView } from "./views/ProjectView";
import { AccountView } from "./views/AccountView";
import { PacksView } from "./views/PacksView";
import { PackViolations } from "./packs-ui";
import { loadReport, loadPublicReport, shareReport, unshareReport, getShare } from "./cloud";
import { getSession, signOut, type SessionUser } from "./auth";
import { SignIn } from "./SignIn";
import { ThemeToggle } from "@ui/components/ui";
import { ExtractionTable } from "./extraction";
import { Insights } from "./insights";
import { Redirects } from "./redirects";
import { useRoute, navigate, back, type Route } from "./router";
import { Toaster, ConfirmHost, ErrorBoundary, Avatar, toast } from "./ui-kit";
import { pendingInvites, acceptInvite, setActiveTeam } from "./cloud";

// Report view state ↔ query string, so any tab/page/filter/rule is a shareable
// URL. Only non-default params are written, keeping links clean.
function parseView(search: string): ReportViewState {
  const q = new URLSearchParams(search);
  const n = (k: string) => { const v = q.get(k); return v == null || v === "" ? null : Number(v); };
  return {
    tab: q.get("tab") ?? "overview",
    page: q.get("page"),
    sev: (q.get("sev") as ReportViewState["sev"]) ?? "all",
    cat: (q.get("cat") as ReportViewState["cat"]) ?? null,
    status: n("status"),
    depth: n("depth"),
    rule: q.get("rule"),
  };
}
function viewToQuery(v: ReportViewState): string {
  const q = new URLSearchParams();
  if (v.tab && v.tab !== "overview") q.set("tab", v.tab);
  if (v.page) q.set("page", v.page);
  if (v.sev && v.sev !== "all") q.set("sev", v.sev);
  if (v.cat) q.set("cat", v.cat);
  if (v.status != null) q.set("status", String(v.status));
  if (v.depth != null) q.set("depth", String(v.depth));
  if (v.rule) q.set("rule", v.rule);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function App() {
  const route = useRoute();
  const view = route.name === "public" ? <PublicReport token={route.token} /> : <AuthedApp route={route} />;
  return (
    <>
      <ErrorBoundary>{view}</ErrorBoundary>
      <Toaster />
      <ConfirmHost />
    </>
  );
}

function AuthedApp({ route }: { route: Route }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  useEffect(() => {
    getSession().then((u) => {
      if (!u && import.meta.env.DEV && !location.search.includes("signin")) {
        u = { id: "dev", email: "you@crawlie.dev" };
      }
      setUser(u);
    });
  }, []);

  const recheck = () => getSession().then((u) => setUser(u));
  if (user === undefined) return <Splash />;
  if (user === null) return <SignIn onSignedIn={recheck} />;
  return <Dashboard user={user} route={route} />;
}

function Dashboard({ user, route }: { user: SessionUser; route: Route }) {
  // Pick running crawls back up after a reload (the container jobs outlive us).
  useEffect(() => { resumeRunningCrawls(); }, []);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("sidebar-collapsed");
      if (stored != null) return stored === "1";
      return typeof window !== "undefined" && window.innerWidth < 720; // collapse on mobile by default
    } catch {
      return false;
    }
  });
  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const onProjects = route.name === "projects" || route.name === "project" || route.name === "report";
  const onNew = route.name === "new";
  const flush = route.name === "project" || route.name === "report" || route.name === "projects" || route.name === "rules";

  return (
    <div className="app">
      <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
        <div className="cw-sidetop">
          <button
            className="sidebar-brand"
            onClick={() => (collapsed ? toggleCollapsed() : navigate("/projects"))}
            title={collapsed ? "Expand sidebar" : "Home"}
            aria-label={collapsed ? "Expand sidebar" : "Home"}
          >
            <span className="cw-brandmark"><Logo /></span>
            {collapsed && <span className="cw-expand"><IconChevron size={18} /></span>}
          </button>
          {!collapsed && (
            <button className="cw-collapse" onClick={toggleCollapsed} title="Collapse sidebar" aria-label="Collapse sidebar">
              <IconChevron size={16} />
            </button>
          )}
        </div>
        <nav className="sidebar-nav">
          <button className={`nav-item${onProjects ? " active" : ""}`} onClick={() => navigate("/projects")} title="Projects">
            <IconGlobe size={16} /> <span className="nav-label">Projects</span>
          </button>
          <button className={`nav-item${onNew ? " active" : ""}`} onClick={() => navigate("/new")} title="New crawl">
            <IconSearch size={16} /> <span className="nav-label">New crawl</span>
          </button>
          <button className={`nav-item${route.name === "rules" ? " active" : ""}`} onClick={() => navigate("/rules")} title="Rules">
            <IconSpark size={16} /> <span className="nav-label">Rules</span>
          </button>
          <RunningCrawls />
        </nav>
        <div className="sidebar-foot">
          <a className="nav-item" href="https://crawlie.dev/docs" onClick={(e) => { e.preventDefault(); openExternal("https://crawlie.dev/docs"); }} title="Docs">
            <IconBook size={16} /> <span className="nav-label">Docs</span>
          </a>
          <AccountMenu user={user} active={route.name === "account"} />
        </div>
      </aside>

      <div className="content">
        <InvitesBanner />
        <main className={`main${flush ? " flush" : ""}`}>
          {route.name === "projects" && <ProjectsView onOpen={(id) => navigate(`/projects/${id}`)} />}
          {route.name === "project" && (
            <ProjectView
              id={route.id}
              onBack={() => navigate("/projects")}
              onOpenReport={(reportId) => navigate(`/reports/${encodeURIComponent(reportId)}`)}
            />
          )}
          {route.name === "report" && <ReportView id={route.id} />}
          {route.name === "new" && <NewCrawl />}
          {route.name === "rules" && <PacksView />}
          {route.name === "account" && <AccountView user={user} onBack={() => navigate("/projects")} />}
          {route.name === "notfound" && (
            <div className="hero">
              <h1 style={{ fontSize: 28 }}>Page not found</h1>
              <p style={{ color: "var(--text-secondary)" }}>That page doesn't exist.</p>
              <button className="btn btn-primary" onClick={() => navigate("/projects")}>Go to Projects</button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// Sidebar strip: one row per running crawl, pulsing while it works. Click to
// jump back to the live view (project page, or /new for ad-hoc crawls).
function RunningCrawls() {
  const crawls = useCrawls();
  if (!crawls.length) return null;
  return (
    <div className="cw-running">
      <div className="cw-running-head nav-label">Running</div>
      {crawls.map((c) => (
        <button
          key={c.key}
          className="nav-item cw-running-item"
          onClick={() => navigate(c.projectId ? `/projects/${c.projectId}` : "/new")}
          title={`Crawling ${shortUrl(c.config.url)} — ${c.progress.crawled} pages`}
        >
          <span className="cw-running-dot" aria-hidden="true" />
          <span className="nav-label cw-running-label">
            <span className="cw-running-host">{shortUrl(c.config.url)}</span>
            <span className="mono cw-running-count">{c.progress.crawled}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

// Ad-hoc crawl under /new. The crawl itself lives in the global store, so
// navigating away doesn't lose it — come back mid-crawl (or after) and the
// live view / result is still here.
function NewCrawl() {
  const { running, finished } = useAdhocCrawl();

  if (running)
    return (
      <CrawlingView
        config={running.config}
        progress={running.progress}
        onCancel={running.cancel}
        onBackground={() => navigate("/projects")}
      />
    );
  if (finished?.status === "done")
    return <ResultsView result={finished.result} onReset={clearAdhocResult} onReports={() => navigate("/projects")} />;
  if (finished?.status === "error")
    return (
      <div className="crawl-msg">
        <div className="crawl-msg-glyph" aria-hidden="true">×_×</div>
        <h1 className="h2">Crawl interrupted</h1>
        <p className="muted" style={{ maxWidth: "46ch", font: "var(--copy-14)" }}>{finished.message}</p>
        <button className="btn btn-primary" onClick={clearAdhocResult}>Try again</button>
      </div>
    );
  return <StartView onStart={startAdhocCrawl} />;
}

// Build the cloud-only report tabs (Insights, Rules, Extraction) injected into
// the shared ResultsView tab bar — so everything lives in one set of tabs.
/** Note shown atop tabs that analyze the hydrated page subset of a big lean
 *  report (the Pages tab itself browses the full crawl via the index). */
function SubsetNote({ result, children }: { result: CrawlResult; children: React.ReactNode }) {
  if (!result.pagesTruncated) return <>{children}</>;
  return (
    <div className="col" style={{ gap: "var(--sp-3)" }}>
      <div className="card card-pad" style={{ padding: "10px 14px", font: "var(--copy-13)", color: "var(--text-secondary)" }}>
        This view analyzes the first {result.pages.length.toLocaleString()} of{" "}
        {(result.summary?.totalPages ?? 0).toLocaleString()} crawled pages. The Pages tab, scores and issues
        cover the <b>full crawl</b>.
      </div>
      {children}
    </div>
  );
}

function reportExtraTabs(result: CrawlResult): ExtraTab[] {
  const packs = (result as { packs?: { pagesFlagged?: number } | null }).packs;
  const pages = (result.pages ?? []) as Array<{ extractions?: unknown[]; redirectChain?: unknown[] }>;
  const hasExtraction = pages.some((p) => (p.extractions ?? []).length > 0);
  const redirectCount = pages.filter((p) => (p.redirectChain ?? []).length > 0).length;
  const tabs: ExtraTab[] = [
    { id: "insights", label: "Insights", wide: true, content: <SubsetNote result={result}><Insights pages={result.pages} /></SubsetNote> },
  ];
  if (redirectCount > 0) tabs.push({ id: "redirects", label: "Redirects", count: redirectCount, wide: true, content: <SubsetNote result={result}><Redirects pages={result.pages} /></SubsetNote> });
  if (packs) tabs.push({ id: "rules", label: "Rules", count: packs.pagesFlagged, wide: true, content: <PackViolations packs={packs} /> });
  if (hasExtraction) tabs.push({ id: "extraction", label: "Extraction", wide: true, content: <SubsetNote result={result}><ExtractionTable pages={result.pages as Parameters<typeof ExtractionTable>[0]["pages"]} /></SubsetNote> });
  return tabs;
}

function ReportView({ id }: { id: string }) {
  const [result, setResult] = useState<CrawlResult | null | undefined>(undefined);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  useEffect(() => {
    loadReport(id).then(async (r) => {
      if (r) return setResult(r);
      if (import.meta.env.DEV) setResult((await import("@ui/lib/demo")).DEMO_RESULT as unknown as CrawlResult);
      else setResult(null);
    });
    getShare(id).then((s) => setShareUrl(s.token ? `https://crawlie.app/p/${s.token}` : null)).catch(() => {});
  }, [id]);
  // Re-parsed whenever the query changes (navigate() re-renders via useRoute).
  const view = useMemo(() => parseView(location.search), [location.search]);

  if (result === undefined) return <div style={{ display: "flex", justifyContent: "center", padding: 80 }}><Spinner /></div>;
  if (result === null)
    return (
      <div className="hero">
        <h1 style={{ fontSize: 24 }}>Report not found</h1>
        <button className="btn btn-primary" onClick={() => back()}>Back</button>
      </div>
    );
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", borderBottom: "1px solid var(--border)", background: "var(--panel, var(--bg))", flexWrap: "wrap" }}>
        <div className="crumbs">
          <button className="crumb-link" onClick={() => navigate("/projects")}>Projects</button>
          <span className="crumb-sep">/</span>
          <span className="crumb-current">Report</span>
        </div>
      </div>
      <ResultsView
        result={result}
        resolvePage={chunkPageResolver(result, `/v1/reports/${encodeURIComponent(id)}`)}
        onReset={() => back()}
        onReports={() => navigate("/projects")}
        extraTabs={reportExtraTabs(result)}
        view={view}
        onView={(v) => navigate(`/reports/${encodeURIComponent(id)}${viewToQuery(v)}`)}
        sharing={{
          url: shareUrl,
          onShare: async () => {
            const s = await shareReport(id);
            setShareUrl(s.url);
            return s.url;
          },
          onUnshare: async () => {
            await unshareReport(id);
            setShareUrl(null);
          },
        }}
      />
    </>
  );
}

function PublicReport({ token }: { token: string }) {
  const [result, setResult] = useState<CrawlResult | null | undefined>(undefined);
  useEffect(() => {
    loadPublicReport(token).then((r) => setResult(r));
  }, [token]);
  const view = useMemo(() => parseView(location.search), [location.search]);
  const home = () => { window.location.href = "https://crawlie.app/"; };
  return (
    <div className="app">
      <div className="content">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
          <button onClick={home} style={{ background: "none", border: 0, cursor: "pointer", display: "flex" }}><Logo /></button>
          <a href="https://crawlie.app/" style={{ fontSize: 13, color: "var(--link, #3b9eff)", textDecoration: "none" }}>Run your own free crawl →</a>
        </div>
        <main className="main flush">
          {result === undefined ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 80 }}><Spinner /></div>
          ) : result === null ? (
            <div className="hero"><h1 style={{ fontSize: 24 }}>This report isn't available</h1><a className="btn btn-primary" href="https://crawlie.app/">Go to Crawlie</a></div>
          ) : (
            <ResultsView
              result={result}
              resolvePage={chunkPageResolver(result, `/pub/reports/${encodeURIComponent(token)}`)}
              onReset={home}
              onReports={home}
              extraTabs={reportExtraTabs(result)}
              view={view}
              onView={(v) => navigate(`/p/${token}${viewToQuery(v)}`)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function AccountMenu({ user, active }: { user: SessionUser; active: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const displayName = user.name?.trim() || user.email;
  return (
    <div ref={ref} className="cw-account" style={{ position: "relative", width: "100%" }}>
      <button
        className={`cw-account-btn${active ? " active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={user.email}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar name={user.name} email={user.email} image={user.image} size={26} />
        <span className="nav-label cw-account-name">{displayName}</span>
      </button>
      {open && (
        <div role="menu" className="cw-menu">
          <div className="cw-menu-head">
            <Avatar name={user.name} email={user.email} image={user.image} size={38} />
            <div style={{ minWidth: 0 }}>
              <div className="cw-menu-name">{displayName}</div>
              {user.name?.trim() && <div className="cw-menu-email">{user.email}</div>}
            </div>
          </div>
          <div className="cw-menu-sep" />
          <div className="cw-menu-row">
            <span>Theme</span>
            <ThemeToggle />
          </div>
          <button role="menuitem" className="cw-menu-item" onClick={() => { setOpen(false); navigate("/account"); }}>
            <IconSettings size={15} /> Account &amp; settings
          </button>
          <div className="cw-menu-sep" />
          <button role="menuitem" className="cw-menu-item" onClick={() => signOut()}>
            <IconLogout size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

const IconLogout = ({ size }: { size?: number }) => (
  <svg width={size ?? 16} height={size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </svg>
);

function InvitesBanner() {
  const [invites, setInvites] = useState<Array<{ id: string; teamId: string; teamName: string }>>([]);
  useEffect(() => { pendingInvites().then(setInvites).catch(() => {}); }, []);
  if (!invites.length) return null;
  return (
    <div>
      {invites.map((i) => (
        <div key={i.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 20px", background: "color-mix(in srgb, var(--blue, #0055ee) 12%, transparent)", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5 }}>You've been invited to join <b>{i.teamName}</b>.</span>
          <button className="btn btn-primary btn-sm" onClick={() => acceptInvite(i.id).then(() => { toast(`Joined ${i.teamName}`, "success"); setActiveTeam(i.teamId); setTimeout(() => location.reload(), 700); })}>Accept invite</button>
        </div>
      ))}
    </div>
  );
}

function Splash() {
  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "var(--bg)" }}>
      <Logo />
    </div>
  );
}
