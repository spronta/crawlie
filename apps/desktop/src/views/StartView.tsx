import { useState } from "react";
import type { CrawlConfig, CrawlMode } from "../lib/types";
import { DEFAULT_CONFIG } from "../lib/types";
import { IconArrowRight, IconChevron, IconSearch } from "../components/ui";
import { isTauri } from "../lib/api";

const MODES: { id: CrawlMode; label: string; hint: string; placeholder: string }[] = [
  { id: "site", label: "Whole site", hint: "Crawl every linked page from the seed.", placeholder: "example.com" },
  { id: "page", label: "Single page", hint: "Audit just one URL.", placeholder: "example.com/pricing" },
  { id: "list", label: "URL list", hint: "Audit specific pages, one per line.", placeholder: "example.com/a\nexample.com/b" },
];

export function StartView({ onStart }: { onStart: (c: CrawlConfig) => void }) {
  const [mode, setMode] = useState<CrawlMode>("site");
  const [url, setUrl] = useState("");
  const [list, setList] = useState("");
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<CrawlConfig>(DEFAULT_CONFIG);

  const normalize = (u: string) => {
    const t = u.trim();
    if (!t) return "";
    return /^https?:\/\//i.test(t) ? t : "https://" + t;
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "list") {
      const urls = list.split(/\n+/).map(normalize).filter(Boolean);
      if (!urls.length) return;
      onStart({ ...cfg, mode, urls, url: urls[0], maxDepth: 0 });
    } else {
      const u = normalize(url);
      if (!u) return;
      onStart({ ...cfg, mode, url: u, maxDepth: mode === "page" ? 0 : cfg.maxDepth });
    }
  }

  const active = MODES.find((m) => m.id === mode)!;
  const numField = (label: string, key: keyof CrawlConfig, min = 1) => (
    <div className="field">
      <label>{label}</label>
      <input
        className="input input-sm mono"
        type="number"
        min={min}
        value={cfg[key] as number}
        onChange={(e) => setCfg({ ...cfg, [key]: Math.max(min, Number(e.target.value) || min) })}
      />
    </div>
  );
  const checkField = (label: string, key: "checkExternal" | "respectRobots" | "useSitemap" | "render") => (
    <label className="field" style={{ justifyContent: "flex-end" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={cfg[key]} onChange={(e) => setCfg({ ...cfg, [key]: e.target.checked })} />
        <span className="muted" style={{ font: "var(--label-13)" }}>{label}</span>
      </span>
    </label>
  );

  return (
    <div className="hero">
      <span className="eyebrow">Open-source SEO + GEO crawler</span>
      <h1>Audit any site in seconds.</h1>
      <p>
        Crawl a website for broken links, redirects, missing metadata, and 40+ SEO and
        Generative-Engine checks — with plain-English guidance on every fix. All on your machine, free.
      </p>

      <div className="segmented" role="tablist">
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? "on" : ""} onClick={() => setMode(m.id)}>{m.label}</button>
        ))}
      </div>

      <form className="crawl-form" onSubmit={submit} style={{ flexDirection: mode === "list" ? "column" : "row", maxWidth: 580 }}>
        {mode === "list" ? (
          <textarea
            className="input mono"
            style={{ height: 120, padding: 12, resize: "vertical", width: "100%" }}
            placeholder={active.placeholder}
            value={list}
            onChange={(e) => setList(e.target.value)}
          />
        ) : (
          <div className="grow" style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }}>
              <IconSearch />
            </span>
            <input className="input mono" style={{ paddingLeft: 40 }} placeholder={active.placeholder} value={url} autoFocus onChange={(e) => setUrl(e.target.value)} />
          </div>
        )}
        <button className="btn btn-primary" type="submit" style={{ height: 48, alignSelf: mode === "list" ? "flex-end" : "auto" }}>
          {mode === "site" ? "Crawl" : "Audit"}
          <IconArrowRight />
        </button>
      </form>

      <span className="tertiary" style={{ font: "var(--label-12)" }}>{active.hint}</span>

      {mode === "site" && (
        <button className="disclosure" onClick={() => setOpen(!open)}>
          <span style={{ display: "inline-flex", transform: open ? "rotate(90deg)" : "none", transition: "transform 150ms" }}>
            <IconChevron size={14} />
          </span>
          Crawl settings
        </button>
      )}

      {open && mode === "site" && (
        <div className="config-grid">
          {numField("Max pages", "maxPages")}
          {numField("Max depth", "maxDepth", 0)}
          {numField("Concurrency", "concurrency")}
          {numField("Timeout (s)", "timeoutSecs")}
          {checkField("Verify external links", "checkExternal")}
          {checkField("Respect robots.txt", "respectRobots")}
          {checkField("Seed from sitemap", "useSitemap")}
          {checkField("Render JavaScript", "render")}
        </div>
      )}

      {open && mode === "site" && cfg.render && (
        <span className="tertiary" style={{ font: "var(--label-12)", marginTop: 2 }}>
          Renders each page in headless Chrome to audit JavaScript-injected content — slower, and
          needs Chrome / Chromium / Edge installed.
        </span>
      )}

      {!isTauri() && (
        <p className="tertiary" style={{ font: "var(--label-12)", marginTop: 8 }}>
          Preview mode — running in a browser shows demo data. Launch the desktop app for live crawls.
        </p>
      )}
    </div>
  );
}
