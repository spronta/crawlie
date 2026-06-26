import { useEffect, useState } from "react";
import {
  appVersion,
  checkForUpdate,
  getSettings,
  latestGithubRelease,
  openExternal,
  relaunchApp,
  type UpdateInfo,
} from "../lib/api";
import { IconExternal, IconX, IconRefresh } from "./ui";

function newer(latest: string, current: string): boolean {
  const a = latest.split(".").map((n) => parseInt(n, 10) || 0);
  const b = current.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

type State =
  | { kind: "hidden" }
  | { kind: "available"; update: UpdateInfo }
  | { kind: "installing"; version: string; pct: number }
  | { kind: "ready"; version: string }
  | { kind: "link"; version: string; url: string }
  | { kind: "error"; message: string };

/** New-version prompt with in-app install. Respects user settings: honors
 *  "check on launch", and auto-installs when "auto-update" is on. Falls back to
 *  a download link if the updater plugin isn't configured. */
export function UpdateBanner() {
  const [state, setState] = useState<State>({ kind: "hidden" });
  const [dismissed, setDismissed] = useState(false);

  async function install(update: UpdateInfo) {
    setState({ kind: "installing", version: update.version, pct: 0 });
    try {
      await update.install((pct) =>
        setState({ kind: "installing", version: update.version, pct })
      );
      setState({ kind: "ready", version: update.version });
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getSettings();
        if (!settings.checkOnLaunch) return;

        const update = await checkForUpdate();
        if (cancelled) return;

        if (update) {
          if (settings.autoUpdate) {
            void install(update);
          } else {
            setState({ kind: "available", update });
          }
          return;
        }

        // Updater not configured / no update — try a plain GitHub lookup.
        const current = await appVersion();
        const rel = await latestGithubRelease();
        if (!cancelled && rel && newer(rel.version, current)) {
          setState({ kind: "link", version: rel.version, url: rel.url });
        }
      } catch {
        // offline or rate-limited — stay silent
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.kind === "hidden" || dismissed) return null;

  const close = (
    <button
      className="icon-btn"
      style={{ width: 28, height: 28 }}
      aria-label="Dismiss"
      onClick={() => setDismissed(true)}
    >
      <IconX size={14} />
    </button>
  );

  return (
    <div className="update-banner">
      {state.kind === "available" && (
        <>
          <span className="grow">
            <strong style={{ fontWeight: 500 }}>crawlie v{state.update.version}</strong> is
            available.
          </span>
          <button className="btn btn-sm btn-primary" onClick={() => install(state.update)}>
            Install &amp; Restart
          </button>
          {close}
        </>
      )}

      {state.kind === "installing" && (
        <>
          <span className="grow">
            Downloading v{state.version}… <strong style={{ fontWeight: 500 }}>{state.pct}%</strong>
          </span>
          <div className="update-progress" aria-hidden>
            <div className="update-progress-bar" style={{ width: `${state.pct}%` }} />
          </div>
        </>
      )}

      {state.kind === "ready" && (
        <>
          <span className="grow">v{state.version} installed. Restart to finish.</span>
          <button className="btn btn-sm btn-primary" onClick={() => void relaunchApp()}>
            <IconRefresh size={13} /> Restart now
          </button>
          {close}
        </>
      )}

      {state.kind === "link" && (
        <>
          <span className="grow">
            <strong style={{ fontWeight: 500 }}>crawlie v{state.version}</strong> is available.
          </span>
          <a
            className="btn btn-sm btn-secondary"
            href={state.url}
            onClick={(e) => { e.preventDefault(); openExternal(state.url); }}
          >
            Download <IconExternal size={13} />
          </a>
          {close}
        </>
      )}

      {state.kind === "error" && (
        <>
          <span className="grow" style={{ color: "var(--red-text)" }}>
            Update failed: {state.message}
          </span>
          {close}
        </>
      )}
    </div>
  );
}
