import { useEffect, useState } from "react";
import {
  appVersion,
  checkForUpdate,
  getSettings,
  latestGithubRelease,
  relaunchApp,
  saveSettings,
  type Settings,
  type UpdateInfo,
} from "../lib/api";
import { IconBack, IconRefresh, IconExternal, Toggle } from "../components/ui";
import { applyTheme, currentTheme, type Theme } from "../lib/theme";
import { getCrawlDefaults, saveCrawlDefaults, type CrawlDefaults } from "../lib/crawl-defaults";

type Check =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "available"; update: UpdateInfo }
  | { kind: "link"; version: string; url: string }
  | { kind: "installing"; version: string; pct: number }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

export function SettingsView({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [version, setVersion] = useState("…");
  const [check, setCheck] = useState<Check>({ kind: "idle" });
  const [theme, setThemeState] = useState<Theme>(() => currentTheme());
  const [defaults, setDefaults] = useState<CrawlDefaults>(() => getCrawlDefaults());

  function setTheme(t: Theme) {
    setThemeState(t);
    applyTheme(t);
  }

  function setDefault<K extends keyof CrawlDefaults>(key: K, v: CrawlDefaults[K]) {
    const next = { ...defaults, [key]: v };
    setDefaults(next);
    saveCrawlDefaults(next);
  }

  const numDefault = (label: string, key: keyof CrawlDefaults, min = 1) => (
    <div className="field">
      <label>{label}</label>
      <input
        className="input input-sm mono"
        type="number"
        min={min}
        value={defaults[key] as number}
        onChange={(e) => setDefault(key, Math.max(min, Number(e.target.value) || min) as CrawlDefaults[typeof key])}
      />
    </div>
  );

  useEffect(() => {
    (async () => {
      setSettings(await getSettings());
      setVersion(await appVersion());
    })();
  }, []);

  async function update(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
  }

  async function install(u: UpdateInfo) {
    setCheck({ kind: "installing", version: u.version, pct: 0 });
    try {
      await u.install((pct) => setCheck({ kind: "installing", version: u.version, pct }));
      setCheck({ kind: "ready", version: u.version });
    } catch (e) {
      setCheck({ kind: "error", message: String(e) });
    }
  }

  async function checkNow() {
    setCheck({ kind: "checking" });
    try {
      const u = await checkForUpdate();
      if (u) {
        setCheck({ kind: "available", update: u });
        return;
      }
      const rel = await latestGithubRelease();
      if (rel && rel.version !== version) {
        setCheck({ kind: "link", version: rel.version, url: rel.url });
      } else {
        setCheck({ kind: "uptodate" });
      }
    } catch (e) {
      setCheck({ kind: "error", message: String(e) });
    }
  }

  return (
    <div className="section-gap" style={{ maxWidth: 640, margin: "0 auto" }}>
      <div className="row between">
        <h1 className="h1">Settings</h1>
        <button className="btn btn-secondary btn-sm" onClick={onBack}>
          <IconBack size={15} /> Back
        </button>
      </div>

      <div className="card card-pad">
        <h2 className="h3" style={{ marginBottom: 4 }}>Appearance</h2>
        <Toggle
          label="Dark mode"
          hint="Use the dark colour theme."
          on={theme === "dark"}
          onChange={(v) => setTheme(v ? "dark" : "light")}
        />
      </div>

      <div className="card card-pad">
        <h2 className="h3" style={{ marginBottom: 4 }}>Crawl defaults</h2>
        <p className="toggle-hint" style={{ marginBottom: 16 }}>
          Applied to every new crawl. You can still override any of these per crawl.
        </p>

        <div className="field" style={{ gap: 6, marginBottom: 16 }}>
          <label>User agent</label>
          <input
            className="input input-sm mono"
            style={{ width: "100%" }}
            value={defaults.userAgent}
            onChange={(e) => setDefault("userAgent", e.target.value)}
          />
        </div>

        <div className="config-grid" style={{ marginBottom: 4 }}>
          {numDefault("Max pages", "maxPages")}
          {numDefault("Max depth", "maxDepth", 0)}
          {numDefault("Concurrency", "concurrency")}
          {numDefault("Timeout (s)", "timeoutSecs")}
        </div>

        <Toggle
          label="Render JavaScript"
          hint="Audit pages after headless Chrome runs their JS. Slower; needs Chrome installed."
          on={defaults.render}
          onChange={(v) => setDefault("render", v)}
        />
        <Toggle
          label="Verify external links"
          hint="HEAD-check links that point off-site."
          on={defaults.checkExternal}
          onChange={(v) => setDefault("checkExternal", v)}
        />
        <Toggle label="Respect robots.txt" on={defaults.respectRobots} onChange={(v) => setDefault("respectRobots", v)} />
        <Toggle label="Seed from sitemap" on={defaults.useSitemap} onChange={(v) => setDefault("useSitemap", v)} />
      </div>

      <div className="card card-pad">
        <h2 className="h3" style={{ marginBottom: 4 }}>Updates</h2>

        {settings && (
          <>
            <Toggle
              label="Check for updates on launch"
              hint="Look for a newer version each time crawlie starts."
              on={settings.checkOnLaunch}
              onChange={(v) => update({ checkOnLaunch: v })}
            />
            <Toggle
              label="Install updates automatically"
              hint="Download and install new versions in the background, then restart."
              on={settings.autoUpdate}
              onChange={(v) => update({ autoUpdate: v })}
            />
          </>
        )}

        <div className="row between" style={{ paddingTop: 16 }}>
          <div className="col" style={{ gap: 2 }}>
            <span className="toggle-label">crawlie v{version}</span>
            <span className="toggle-hint">
              {check.kind === "checking" && "Checking…"}
              {check.kind === "uptodate" && "You're on the latest version."}
              {check.kind === "available" && `v${check.update.version} is available.`}
              {check.kind === "link" && `v${check.version} is available.`}
              {check.kind === "installing" && `Downloading v${check.version}… ${check.pct}%`}
              {check.kind === "ready" && `v${check.version} installed — restart to finish.`}
              {check.kind === "error" && `Update check failed.`}
              {check.kind === "idle" && "Up to date as far as we know."}
            </span>
          </div>

          {check.kind === "available" ? (
            <button className="btn btn-primary btn-sm" onClick={() => install(check.update)}>
              Install &amp; Restart
            </button>
          ) : check.kind === "ready" ? (
            <button className="btn btn-primary btn-sm" onClick={() => void relaunchApp()}>
              <IconRefresh size={13} /> Restart now
            </button>
          ) : check.kind === "link" ? (
            <a className="btn btn-secondary btn-sm" href={check.url} target="_blank" rel="noreferrer">
              Download <IconExternal size={13} />
            </a>
          ) : (
            <button
              className="btn btn-secondary btn-sm"
              onClick={checkNow}
              disabled={check.kind === "checking" || check.kind === "installing"}
            >
              <IconRefresh size={13} /> Check now
            </button>
          )}
        </div>

        {check.kind === "error" && (
          <p className="mono" style={{ color: "var(--red-text)", marginTop: 10, fontSize: 13 }}>
            {check.message}
          </p>
        )}
      </div>
    </div>
  );
}
