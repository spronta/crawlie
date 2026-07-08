import { useCallback, useEffect, useState } from "react";
import type { CrawlConfig, CrawlResult } from "@ui/lib/types";
import { cancelCrawl, openExternal, startCrawl } from "@platform/api";
import { Logo, IconBook, IconExternal, IconGlobe, IconSearch, IconChevron, IconUser, IconSpark, Spinner } from "@ui/components/ui";
import { StartView } from "@ui/views/StartView";
import { CrawlingView, type Progress } from "@ui/views/CrawlingView";
import { ResultsView } from "@ui/views/ResultsView";
import { ProjectsView } from "./views/ProjectsView";
import { ProjectView } from "./views/ProjectView";
import { AccountView } from "./views/AccountView";
import { PacksView } from "./views/PacksView";
import { PackViolations } from "./packs-ui";
import { loadReport, loadPublicReport, shareReport, unshareReport, getShare } from "./cloud";
import { getSession, signOut, type SessionUser } from "./auth";
import { SignIn } from "./SignIn";
import { IconShare } from "@ui/components/ui";
import { ExtractionTable } from "./extraction";
import { useRoute, navigate, back, type Route } from "./router";

export function App() {
  const route = useRoute();
  if (route.name === "public") return <PublicReport token={route.token} />;
  return <AuthedApp route={route} />;
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
  const [collapsed, setCollapsed] = useState<boolean>(
    () => typeof localStorage !== "undefined" && localStorage.getItem("sidebar-collapsed") === "1",
  );
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
        <button className="sidebar-brand" onClick={() => navigate("/projects")} aria-label="Home">
          <Logo />
        </button>
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
          <a className="nav-item" href="https://github.com/spronta/crawlie" onClick={(e) => { e.preventDefault(); openExternal("https://github.com/spronta/crawlie"); }} title="GitHub">
            <IconExternal size={15} /> <span className="nav-label">GitHub</span>
          </a>
          <AccountMenu user={user} active={route.name === "account"} />
          <div className="sidebar-foot-row">
            <button className="icon-btn collapse-toggle" onClick={toggleCollapsed} title={collapsed ? "Expand" : "Collapse"} aria-label="Toggle sidebar">
              <IconChevron size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="content">
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
          {route.name === "account" && <AccountView email={user.email} onBack={() => navigate("/projects")} />}
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

function ReportView({ id }: { id: string }) {
  const [result, setResult] = useState<CrawlResult | null | undefined>(undefined);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    loadReport(id).then((r) => setResult(r));
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
        <button className="btn btn-sm" onClick={() => back()}>← Back</button>
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
      <PackViolations packs={(result as { packs?: unknown }).packs} />
      <ExtractionTable pages={(result.pages ?? []) as Parameters<typeof ExtractionTable>[0]["pages"]} />
      <ResultsView result={result} onReset={() => back()} onReports={() => navigate("/projects")} />
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
            <ResultsView result={result} onReset={home} onReports={home} />
          )}
        </main>
      </div>
    </div>
  );
}

function AccountMenu({ user, active }: { user: SessionUser; active: boolean }) {
  const [open, setOpen] = useState(false);
  const item: React.CSSProperties = { marginTop: 10, width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-subtle, transparent)", color: "var(--text)", fontSize: 13, cursor: "pointer" };
  return (
    <div className="account" style={{ position: "relative" }}>
      <button className={`nav-item${active ? " active" : ""}`} onClick={() => setOpen((o) => !o)} title={user.email}>
        <IconUser size={16} />{" "}
        <span className="nav-label" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</span>
      </button>
      {open && (
        <div role="dialog" style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, width: 232, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "var(--shadow-pop, 0 8px 30px rgba(0,0,0,.18))", padding: 14, zIndex: 40 }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>Signed in as</div>
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", wordBreak: "break-all" }}>{user.email}</div>
          <button onClick={() => { setOpen(false); navigate("/account"); }} style={item}>Account &amp; API keys</button>
          <button onClick={() => signOut()} style={item}>Sign out</button>
        </div>
      )}
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
