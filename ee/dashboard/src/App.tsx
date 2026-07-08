import { useCallback, useEffect, useRef, useState } from "react";
import type { CrawlConfig, CrawlResult } from "@ui/lib/types";
import { cancelCrawl, openExternal, startCrawl } from "@platform/api";
import { Logo, IconBook, IconGlobe, IconSearch, IconChevron, IconSettings, IconSpark, Spinner } from "@ui/components/ui";
import { StartView } from "@ui/views/StartView";
import { CrawlingView, type Progress } from "@ui/views/CrawlingView";
import { ResultsView, type ExtraTab } from "@ui/views/ResultsView";
import { ProjectsView } from "./views/ProjectsView";
import { ProjectView } from "./views/ProjectView";
import { AccountView } from "./views/AccountView";
import { PacksView } from "./views/PacksView";
import { PackViolations } from "./packs-ui";
import { loadReport, loadPublicReport, shareReport, unshareReport, getShare } from "./cloud";
import { getSession, signOut, type SessionUser } from "./auth";
import { SignIn } from "./SignIn";
import { IconShare, ThemeToggle } from "@ui/components/ui";
import { ExtractionTable } from "./extraction";
import { Insights } from "./insights";
import { Redirects } from "./redirects";
import { useRoute, navigate, back, type Route } from "./router";
import { Toaster, ConfirmHost, ErrorBoundary, Avatar, toast } from "./ui-kit";
import { pendingInvites, acceptInvite, setActiveTeam } from "./cloud";

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
  const flush = route.name === "project" || route.name === "report";

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

// Ad-hoc crawl — ephemeral idle/crawling/done state lives here, under /new.
function NewCrawl() {
  type S =
    | { name: "idle" }
    | { name: "crawling"; config: CrawlConfig; progress: Progress }
    | { name: "done"; result: CrawlResult }
    | { name: "error"; message: string };
  const [s, setS] = useState<S>({ name: "idle" });

  const start = useCallback(async (config: CrawlConfig) => {
    setS({ name: "crawling", config, progress: { crawled: 0, discovered: 0, queued: 0, current: config.url } });
    try {
      const result = await startCrawl(config, (e) => {
        if (e.type === "progress") {
          setS((p) => (p.name === "crawling" ? { ...p, progress: { crawled: e.crawled, discovered: e.discovered, queued: e.queued, current: e.current } } : p));
        }
      });
      setS({ name: "done", result });
    } catch (err) {
      setS({ name: "error", message: String(err) });
    }
  }, []);

  if (s.name === "crawling") return <CrawlingView config={s.config} progress={s.progress} onCancel={() => cancelCrawl()} />;
  if (s.name === "done") return <ResultsView result={s.result} onReset={() => setS({ name: "idle" })} onReports={() => navigate("/projects")} />;
  if (s.name === "error")
    return (
      <div className="hero">
        <h1 style={{ fontSize: 28 }}>Crawl failed</h1>
        <p className="mono" style={{ color: "var(--red-text)" }}>{s.message}</p>
        <button className="btn btn-primary" onClick={() => setS({ name: "idle" })}>Try again</button>
      </div>
    );
  return <StartView onStart={start} />;
}

// Build the cloud-only report tabs (Insights, Rules, Extraction) injected into
// the shared ResultsView tab bar — so everything lives in one set of tabs.
function reportExtraTabs(result: CrawlResult): ExtraTab[] {
  const packs = (result as { packs?: { pagesFlagged?: number } | null }).packs;
  const pages = (result.pages ?? []) as Array<{ extractions?: unknown[]; redirectChain?: unknown[] }>;
  const hasExtraction = pages.some((p) => (p.extractions ?? []).length > 0);
  const redirectCount = pages.filter((p) => (p.redirectChain ?? []).length > 0).length;
  const tabs: ExtraTab[] = [
    { id: "insights", label: "Insights", wide: true, content: <Insights pages={result.pages} /> },
  ];
  if (redirectCount > 0) tabs.push({ id: "redirects", label: "Redirects", count: redirectCount, wide: true, content: <Redirects pages={result.pages} /> });
  if (packs) tabs.push({ id: "rules", label: "Rules", count: packs.pagesFlagged, wide: true, content: <PackViolations packs={packs} /> });
  if (hasExtraction) tabs.push({ id: "extraction", label: "Extraction", wide: true, content: <ExtractionTable pages={result.pages as Parameters<typeof ExtractionTable>[0]["pages"]} /> });
  return tabs;
}

function ReportView({ id }: { id: string }) {
  const [result, setResult] = useState<CrawlResult | null | undefined>(undefined);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    loadReport(id).then(async (r) => {
      if (r) return setResult(r);
      if (import.meta.env.DEV) setResult((await import("@ui/lib/demo")).DEMO_RESULT as unknown as CrawlResult);
      else setResult(null);
    });
    getShare(id).then((s) => setShareUrl(s.token ? `https://crawlie.app/p/${s.token}` : null)).catch(() => {});
  }, [id]);

  async function share() {
    const s = await shareReport(id);
    setShareUrl(s.url);
    navigator.clipboard?.writeText(s.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  async function unshare() {
    await unshareReport(id);
    setShareUrl(null);
  }

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
        <div style={{ flex: 1 }} />
        {shareUrl ? (
          <>
            <code style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, background: "var(--panel-2, transparent)", padding: "3px 7px", borderRadius: 6, border: "1px solid var(--border-soft, var(--border))" }}>{shareUrl}</code>
            <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied!" : "Copy"}</button>
            <button className="btn btn-sm" onClick={unshare}>Make private</button>
          </>
        ) : (
          <button className="btn btn-sm" onClick={share}><IconShare size={14} /> Share public link</button>
        )}
      </div>
      <ResultsView result={result} onReset={() => back()} onReports={() => navigate("/projects")} extraTabs={reportExtraTabs(result)} />
    </>
  );
}

function PublicReport({ token }: { token: string }) {
  const [result, setResult] = useState<CrawlResult | null | undefined>(undefined);
  useEffect(() => {
    loadPublicReport(token).then((r) => setResult(r));
  }, [token]);
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
            <ResultsView result={result} onReset={home} onReports={home} extraTabs={reportExtraTabs(result)} />
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
