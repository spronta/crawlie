import { useState } from "react";
import type { CrawlConfig, CrawlMode, UrlFilter } from "../lib/types";
import { DEFAULT_CONFIG } from "../lib/types";
import { getCrawlDefaults } from "../lib/crawl-defaults";
import { IconArrowRight, IconChevron, IconSearch, Toggle } from "../components/ui";

/** Split a textarea into one trimmed entry per line, as exclusion rules. */
const toFilters = (text: string, regex: boolean): UrlFilter[] =>
  text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((value) => ({ value, regex }));
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
  const [cfg, setCfg] = useState<CrawlConfig>(() => ({ ...DEFAULT_CONFIG, ...getCrawlDefaults() }));
  const [advanced, setAdvanced] = useState(false);
  const [hostsText, setHostsText] = useState("");
  const [pathsText, setPathsText] = useState("");
  const [hostsRegex, setHostsRegex] = useState(false);
  const [pathsRegex, setPathsRegex] = useState(false);

  const normalize = (u: string) => {
    const t = u.trim();
    if (!t) return "";
    return /^https?:\/\//i.test(t) ? t : "https://" + t;
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Exclusions only apply when following links, i.e. whole-site crawls.
    const exclusions =
      mode === "site"
        ? { excludeHosts: toFilters(hostsText, hostsRegex), excludePaths: toFilters(pathsText, pathsRegex) }
        : { excludeHosts: [], excludePaths: [] };
    if (mode === "list") {
      const urls = list.split(/\n+/).map(normalize).filter(Boolean);
      if (!urls.length) return;
      onStart({ ...cfg, ...exclusions, mode, urls, url: urls[0], maxDepth: 0 });
    } else {
      const u = normalize(url);
      if (!u) return;
      onStart({ ...cfg, ...exclusions, mode, url: u, maxDepth: mode === "page" ? 0 : cfg.maxDepth });
    }
  }

  const active = MODES.find((m) => m.id === mode)!;
  const set = <K extends keyof CrawlConfig>(key: K, v: CrawlConfig[K]) => setCfg({ ...cfg, [key]: v });

  const numField = (label: string, key: keyof CrawlConfig, min = 1) => (
    <div className="field">
      <label>{label}</label>
      <input
        className="input input-sm mono"
        type="number"
        min={min}
        value={cfg[key] as number}
        onChange={(e) => set(key, Math.max(min, Number(e.target.value) || min) as CrawlConfig[typeof key])}
      />
    </div>
  );

  return (
    <div className="hero">
      <span className="eyebrow">Open-source SEO + GEO crawler</span>
      <h1>Audit any site in seconds.</h1>
      <p>
        Crawl a website for broken links, redirects, missing metadata, and 40+ SEO and
        Generative-Engine checks — with plain-English guidance on every fix. All on your machine, free.
      </p>

      <form className="audit-card card" onSubmit={submit}>
        <div className="segmented" role="tablist">
          {MODES.map((m) => (
            <button type="button" key={m.id} className={mode === m.id ? "on" : ""} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>

        <div className={`audit-input${mode === "list" ? " col" : ""}`}>
          {mode === "list" ? (
            <textarea
              className="input mono"
              style={{ height: 110, padding: 12, resize: "vertical", width: "100%" }}
              placeholder={active.placeholder}
              value={list}
              onChange={(e) => setList(e.target.value)}
            />
          ) : (
            <div className="grow" style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }}>
                <IconSearch />
              </span>
              <input
                className="input mono"
                style={{ paddingLeft: 40, width: "100%" }}
                placeholder={active.placeholder}
                value={url}
                autoFocus
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          )}
          <button className="btn btn-primary" type="submit" style={{ height: 48, alignSelf: mode === "list" ? "flex-end" : "auto" }}>
            {mode === "site" ? "Crawl" : "Audit"}
            <IconArrowRight />
          </button>
        </div>
        <span className="tertiary audit-hint">{active.hint}</span>

        <div className="audit-settings">
          {mode === "site" && (
            <div className="config-grid">
              {numField("Max pages", "maxPages")}
              {numField("Max depth", "maxDepth", 0)}
              {numField("Concurrency", "concurrency")}
              {numField("Timeout (s)", "timeoutSecs")}
            </div>
          )}
          <div className="audit-toggles">
            {mode === "site" && (
              <>
                <Toggle on={cfg.checkExternal} onChange={(v) => set("checkExternal", v)} label="Verify external links" hint="HEAD-check links that point off-site." />
                <Toggle on={cfg.respectRobots} onChange={(v) => set("respectRobots", v)} label="Respect robots.txt" />
                <Toggle on={cfg.useSitemap} onChange={(v) => set("useSitemap", v)} label="Seed from sitemap" />
              </>
            )}
            <Toggle
              on={cfg.render}
              onChange={(v) => set("render", v)}
              label="Render JavaScript"
              hint="Audit each page after headless Chrome runs its JS — for React, Vue & Next sites. Slower; needs Chrome / Chromium / Edge installed."
            />
          </div>

          {mode === "site" && (
            <div className="audit-advanced">
              <button type="button" className="disclosure" onClick={() => setAdvanced(!advanced)}>
                <span style={{ display: "inline-flex", transform: advanced ? "rotate(90deg)" : "none", transition: "transform 150ms" }}>
                  <IconChevron size={14} />
                </span>
                Advanced — user agent & exclusions
              </button>

              {advanced && (
                <div className="advanced-panel">
                  <div className="field">
                    <label>User agent</label>
                    <input
                      className="input input-sm mono"
                      style={{ width: "100%" }}
                      value={cfg.userAgent}
                      onChange={(e) => set("userAgent", e.target.value)}
                      placeholder="crawlie/…"
                    />
                  </div>

                  <div className="exclude-group">
                    <div className="exclude-head">
                      <label>Excluded hosts</label>
                      <label className="regex-inline">
                        Regex
                        <button
                          type="button"
                          role="switch"
                          aria-checked={hostsRegex}
                          aria-label="Match hosts as regex"
                          className={`switch sm${hostsRegex ? " on" : ""}`}
                          onClick={() => setHostsRegex(!hostsRegex)}
                        >
                          <span className="knob" />
                        </button>
                      </label>
                    </div>
                    <textarea
                      className="input mono"
                      style={{ height: 70, padding: 10, resize: "vertical", width: "100%" }}
                      placeholder={hostsRegex ? "^ads\\.\nfacebook\\.com$" : "twitter.com\nfacebook"}
                      value={hostsText}
                      onChange={(e) => setHostsText(e.target.value)}
                    />
                    <span className="tertiary exclude-hint">
                      One per line.{" "}
                      {hostsRegex
                        ? "Each line is a regular expression matched against the host."
                        : "Substring match — “twitter” matches twitter.com and twitter.net."}
                    </span>
                  </div>

                  <div className="exclude-group">
                    <div className="exclude-head">
                      <label>Excluded paths</label>
                      <label className="regex-inline">
                        Regex
                        <button
                          type="button"
                          role="switch"
                          aria-checked={pathsRegex}
                          aria-label="Match paths as regex"
                          className={`switch sm${pathsRegex ? " on" : ""}`}
                          onClick={() => setPathsRegex(!pathsRegex)}
                        >
                          <span className="knob" />
                        </button>
                      </label>
                    </div>
                    <textarea
                      className="input mono"
                      style={{ height: 70, padding: 10, resize: "vertical", width: "100%" }}
                      placeholder={pathsRegex ? "\\.php$\n^/cart" : "/share\n/cart"}
                      value={pathsText}
                      onChange={(e) => setPathsText(e.target.value)}
                    />
                    <span className="tertiary exclude-hint">
                      One per line.{" "}
                      {pathsRegex
                        ? "Each line is a regular expression matched against the URL path."
                        : "Substring match — “/share” matches any path containing it."}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </form>

      {!isTauri() && (
        <p className="tertiary" style={{ font: "var(--label-12)", marginTop: 8 }}>
          Preview mode — running in a browser shows demo data. Launch the desktop app for live crawls.
        </p>
      )}
    </div>
  );
}
