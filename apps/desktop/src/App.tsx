import { useCallback, useState } from "react";
import type { CrawlConfig, CrawlResult } from "./lib/types";
import { cancelCrawl, startCrawl } from "./lib/api";
import { Logo, ThemeToggle, IconExternal, IconHistory, IconSettings } from "./components/ui";
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

  return (
    <div className="app">
      <header className="topbar" data-tauri-drag-region>
        <button onClick={reset} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", font: "inherit" }} aria-label="Home">
          <Logo />
        </button>
        <div className="spacer" data-tauri-drag-region />
        <button className="btn btn-ghost btn-sm" onClick={() => setPhase({ name: "reports" })}>
          <IconHistory size={15} /> Reports
        </button>
        <a className="btn btn-ghost btn-sm" href="https://github.com/spronta/crawlie" target="_blank" rel="noreferrer">
          GitHub <IconExternal size={14} />
        </a>
        <button className="icon-btn" aria-label="Settings" onClick={() => setPhase({ name: "settings" })}>
          <IconSettings size={16} />
        </button>
        <ThemeToggle />
      </header>

      <UpdateBanner />

      <main className="main">
        {phase.name === "idle" && <StartView onStart={start} />}
        {phase.name === "crawling" && <CrawlingView config={phase.config} progress={phase.progress} onCancel={cancel} />}
        {phase.name === "done" && <ResultsView result={phase.result} onReset={reset} />}
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
  );
}
