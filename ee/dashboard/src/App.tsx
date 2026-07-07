import { useCallback, useEffect, useState } from "react";
import type { CrawlConfig, CrawlResult } from "@ui/lib/types";
import { cancelCrawl, openExternal, startCrawl } from "@platform/api";
import {
  Logo,
  IconBook,
  IconExternal,
  IconHistory,
  IconSettings,
  IconSearch,
  IconChevron,
  IconUser,
} from "@ui/components/ui";
import { StartView } from "@ui/views/StartView";
import { CrawlingView, type Progress } from "@ui/views/CrawlingView";
import { ResultsView } from "@ui/views/ResultsView";
import { ReportsView } from "@ui/views/ReportsView";
import { SettingsView } from "@ui/views/SettingsView";
import { getSession, signOut, type SessionUser } from "./auth";
import { SignIn } from "./SignIn";

type Phase =
  | { name: "idle" }
  | { name: "crawling"; config: CrawlConfig; progress: Progress }
  | { name: "done"; result: CrawlResult }
  | { name: "reports" }
  | { name: "settings" }
  | { name: "error"; message: string };

export function App() {
  // undefined = still checking the session; null = signed out.
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  useEffect(() => {
    getSession().then((u) => {
      // Dev convenience: preview the app without a live cross-site session.
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
  const [phase, setPhase] = useState<Phase>({ name: "idle" });

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

  const reset = useCallback(() => setPhase({ name: "idle" }), []);
  const cancel = useCallback(() => cancelCrawl(), []);

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

  const inCrawl =
    phase.name === "idle" || phase.name === "crawling" || phase.name === "done" || phase.name === "error";

  return (
    <div className="app">
      <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
        <button className="sidebar-brand" onClick={reset} aria-label="Home">
          <Logo />
        </button>
        <nav className="sidebar-nav">
          <button className={`nav-item${inCrawl ? " active" : ""}`} onClick={reset} title="New crawl">
            <IconSearch size={16} /> <span className="nav-label">New crawl</span>
          </button>
          <button
            className={`nav-item${phase.name === "reports" ? " active" : ""}`}
            onClick={() => setPhase({ name: "reports" })}
            title="Reports"
          >
            <IconHistory size={16} /> <span className="nav-label">Reports</span>
          </button>
        </nav>
        <div className="sidebar-foot">
          <a
            className="nav-item"
            href="https://crawlie.dev/docs"
            onClick={(e) => { e.preventDefault(); openExternal("https://crawlie.dev/docs"); }}
            title="Docs"
          >
            <IconBook size={16} /> <span className="nav-label">Docs</span>
          </a>
          <a
            className="nav-item"
            href="https://github.com/spronta/crawlie"
            onClick={(e) => { e.preventDefault(); openExternal("https://github.com/spronta/crawlie"); }}
            title="GitHub"
          >
            <IconExternal size={15} /> <span className="nav-label">GitHub</span>
          </a>
          <button
            className={`nav-item${phase.name === "settings" ? " active" : ""}`}
            onClick={() => setPhase({ name: "settings" })}
            title="Settings"
          >
            <IconSettings size={16} /> <span className="nav-label">Settings</span>
          </button>
          <AccountMenu user={user} />
          <div className="sidebar-foot-row">
            <button
              className="icon-btn collapse-toggle"
              onClick={toggleCollapsed}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <IconChevron size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="content">
        <main className={`main${phase.name === "done" || phase.name === "reports" ? " flush" : ""}`}>
          {phase.name === "idle" && <StartView onStart={start} />}
          {phase.name === "crawling" && <CrawlingView config={phase.config} progress={phase.progress} onCancel={cancel} />}
          {phase.name === "done" && <ResultsView result={phase.result} onReset={reset} onReports={() => setPhase({ name: "reports" })} />}
          {phase.name === "reports" && <ReportsView onBack={reset} onOpen={(r) => setPhase({ name: "done", result: r })} />}
          {phase.name === "settings" && <SettingsView onBack={reset} />}
          {phase.name === "error" && (
            <div className="hero">
              <h1 style={{ fontSize: 28 }}>Crawl failed</h1>
              <p className="mono" style={{ color: "var(--red-text)" }}>{phase.message}</p>
              <button className="btn btn-primary" onClick={reset}>Try again</button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function AccountMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="account" style={{ position: "relative" }}>
      <button className="nav-item" onClick={() => setOpen((o) => !o)} title={user.email}>
        <IconUser size={16} />{" "}
        <span className="nav-label" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {user.email}
        </span>
      </button>
      {open && (
        <div
          role="dialog"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            width: 232,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "var(--shadow-pop, 0 8px 30px rgba(0,0,0,.18))",
            padding: 14,
            zIndex: 40,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>Signed in as</div>
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", wordBreak: "break-all" }}>{user.email}</div>
          <button
            onClick={() => signOut()}
            style={{
              marginTop: 12,
              width: "100%",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-subtle, transparent)",
              color: "var(--text)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Splash() {
  return (
    <div style={centered}>
      <Logo />
    </div>
  );
}

const centered: React.CSSProperties = {
  minHeight: "100dvh",
  display: "grid",
  placeItems: "center",
  padding: 24,
  background: "var(--bg)",
};
