import { useCallback, useEffect, useState } from "react";
import type { CrawlConfig, CrawlResult } from "./lib/types";
import { cancelCrawl, openExternal, startCrawl, watchFullscreen } from "./lib/api";
import { Logo, IconBook, IconExternal, IconHistory, IconSettings, IconSearch, IconChevron } from "./components/ui";
import { StartView } from "./views/StartView";
import { CrawlingView, type Progress } from "./views/CrawlingView";
import { ResultsView } from "./views/ResultsView";
import { ReportsView } from "./views/ReportsView";
import { SettingsView } from "./views/SettingsView";
import { UpdateBanner } from "./components/UpdateBanner";

type Phase =
  | { name: "idle" }
  | { name: "crawling"; config: CrawlConfig; progress: Progress }
  | { name: "done"; result: CrawlResult }
  | { name: "reports" }
  | { name: "settings" }
  | { name: "error"; message: string };

export function App() {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });

  const start = useCallback(async (config: CrawlConfig) => {
    setPhase({ name: "crawling", config, progress: { crawled: 0, discovered: 0, queued: 0, current: config.url } });
    try {
      const result = await startCrawl(config, (e) => {
        if (e.type === "progress") {
          setPhase((p) =>
            p.name === "crawling"
              ? { ...p, progress: { crawled: e.crawled, discovered: e.discovered, queued: e.queued, current: e.current } }
              : p
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
    () => typeof localStorage !== "undefined" && localStorage.getItem("sidebar-collapsed") === "1"
  );
  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      } catch {
        /* storage may be unavailable; ignore */
      }
      return next;
    });
  }, []);

  // Drop the sidebar's traffic-light spacing when the window is fullscreen.
  useEffect(() => {
    let un: (() => void) | undefined;
    watchFullscreen().then((u) => {
      un = u;
    });
    return () => un?.();
  }, []);

  const inCrawl =
    phase.name === "idle" || phase.name === "crawling" || phase.name === "done" || phase.name === "error";

  return (
    <div className="app">
      <aside className={`sidebar${collapsed ? " collapsed" : ""}`} data-tauri-drag-region>
        <button className="sidebar-brand" onClick={reset} aria-label="Home">
          <Logo />
        </button>
        <nav className="sidebar-nav">
          <button
            className={`nav-item${inCrawl ? " active" : ""}`}
            onClick={reset}
            title="New crawl"
          >
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
        <UpdateBanner />
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
