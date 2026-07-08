import { useCallback, useEffect, useState } from "react";
import type { CrawlConfig, CrawlResult } from "@ui/lib/types";
import { cancelCrawl, openExternal, startCrawl } from "@platform/api";
import { Logo, IconBook, IconExternal, IconGlobe, IconSearch, IconChevron, IconUser, Spinner } from "@ui/components/ui";
import { StartView } from "@ui/views/StartView";
import { CrawlingView, type Progress } from "@ui/views/CrawlingView";
import { ResultsView } from "@ui/views/ResultsView";
import { ProjectsView } from "./views/ProjectsView";
import { ProjectView } from "./views/ProjectView";
import { AccountView } from "./views/AccountView";
import { loadReport } from "./cloud";
import { getSession, signOut, type SessionUser } from "./auth";
import { SignIn } from "./SignIn";

type Phase =
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "report"; id: string; back: Phase }
  | { name: "idle" }
  | { name: "crawling"; config: CrawlConfig; progress: Progress }
  | { name: "done"; result: CrawlResult }
  | { name: "account" }
  | { name: "error"; message: string };

export function App() {
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
  return <Dashboard user={user} />;
}

function Dashboard({ user }: { user: SessionUser }) {
  const [phase, setPhase] = useState<Phase>({ name: "projects" });

  const start = useCallback(async (config: CrawlConfig) => {
    setPhase({ name: "crawling", config, progress: { crawled: 0, discovered: 0, queued: 0, current: config.url } });
    try {
      const result = await startCrawl(config, (e) => {
        if (e.type === "progress") {
          setPhase((p) =>
            p.name === "crawling"
              ? { ...p, progress: { crawled: e.crawled, discovered: e.discovered, queued: e.queued, current: e.current } }
              : p,
          );
        }
      });
      setPhase({ name: "done", result });
    } catch (err) {
      setPhase({ name: "error", message: String(err) });
    }
  }, []);

  const toProjects = useCallback(() => setPhase({ name: "projects" }), []);
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

  const onProjects = phase.name === "projects" || phase.name === "project";
  const onCrawl = phase.name === "idle" || phase.name === "crawling" || phase.name === "done";
  const flush = phase.name === "done" || phase.name === "project" || phase.name === "report";

  return (
    <div className="app">
      <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
        <button className="sidebar-brand" onClick={toProjects} aria-label="Home">
          <Logo />
        </button>
        <nav className="sidebar-nav">
          <button className={`nav-item${onProjects ? " active" : ""}`} onClick={toProjects} title="Projects">
            <IconGlobe size={16} /> <span className="nav-label">Projects</span>
          </button>
          <button className={`nav-item${onCrawl ? " active" : ""}`} onClick={() => setPhase({ name: "idle" })} title="New crawl">
            <IconSearch size={16} /> <span className="nav-label">New crawl</span>
          </button>
        </nav>
        <div className="sidebar-foot">
          <a className="nav-item" href="https://crawlie.dev/docs" onClick={(e) => { e.preventDefault(); openExternal("https://crawlie.dev/docs"); }} title="Docs">
            <IconBook size={16} /> <span className="nav-label">Docs</span>
          </a>
          <a className="nav-item" href="https://github.com/spronta/crawlie" onClick={(e) => { e.preventDefault(); openExternal("https://github.com/spronta/crawlie"); }} title="GitHub">
            <IconExternal size={15} /> <span className="nav-label">GitHub</span>
          </a>
          <AccountMenu user={user} onAccount={() => setPhase({ name: "account" })} />
          <div className="sidebar-foot-row">
            <button className="icon-btn collapse-toggle" onClick={toggleCollapsed} title={collapsed ? "Expand" : "Collapse"} aria-label="Toggle sidebar">
              <IconChevron size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="content">
        <main className={`main${flush ? " flush" : ""}`}>
          {phase.name === "projects" && <ProjectsView onOpen={(id) => setPhase({ name: "project", id })} />}
          {phase.name === "project" && (
            <ProjectView
              id={phase.id}
              onBack={toProjects}
              onOpenReport={(reportId) => setPhase({ name: "report", id: reportId, back: phase })}
            />
          )}
          {phase.name === "report" && (
            <ReportView id={phase.id} onBack={() => setPhase(phase.back)} onReports={toProjects} />
          )}
          {phase.name === "idle" && <StartView onStart={start} />}
          {phase.name === "crawling" && <CrawlingView config={phase.config} progress={phase.progress} onCancel={() => cancelCrawl()} />}
          {phase.name === "done" && <ResultsView result={phase.result} onReset={() => setPhase({ name: "idle" })} onReports={toProjects} />}
          {phase.name === "account" && <AccountView email={user.email} onBack={toProjects} />}
          {phase.name === "error" && (
            <div className="hero">
              <h1 style={{ fontSize: 28 }}>Crawl failed</h1>
              <p className="mono" style={{ color: "var(--red-text)" }}>{phase.message}</p>
              <button className="btn btn-primary" onClick={() => setPhase({ name: "idle" })}>Try again</button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ReportView({ id, onBack, onReports }: { id: string; onBack: () => void; onReports: () => void }) {
  const [result, setResult] = useState<CrawlResult | null | undefined>(undefined);
  useEffect(() => {
    loadReport(id).then((r) => setResult(r));
  }, [id]);
  if (result === undefined) return <div style={{ display: "flex", justifyContent: "center", padding: 80 }}><Spinner /></div>;
  if (result === null)
    return (
      <div className="hero">
        <h1 style={{ fontSize: 24 }}>Report not found</h1>
        <button className="btn btn-primary" onClick={onBack}>Back</button>
      </div>
    );
  return <ResultsView result={result} onReset={onBack} onReports={onReports} />;
}

function AccountMenu({ user, onAccount }: { user: SessionUser; onAccount: () => void }) {
  const [open, setOpen] = useState(false);
  const item: React.CSSProperties = { marginTop: 10, width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-subtle, transparent)", color: "var(--text)", fontSize: 13, cursor: "pointer" };
  return (
    <div className="account" style={{ position: "relative" }}>
      <button className="nav-item" onClick={() => setOpen((o) => !o)} title={user.email}>
        <IconUser size={16} />{" "}
        <span className="nav-label" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</span>
      </button>
      {open && (
        <div role="dialog" style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, width: 232, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "var(--shadow-pop, 0 8px 30px rgba(0,0,0,.18))", padding: 14, zIndex: 40 }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>Signed in as</div>
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", wordBreak: "break-all" }}>{user.email}</div>
          <button onClick={() => { setOpen(false); onAccount(); }} style={item}>Account &amp; API keys</button>
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
