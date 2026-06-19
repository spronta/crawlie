import { useEffect, useState } from "react";
import { isTauri } from "../lib/api";
import { IconExternal, IconX } from "./ui";

const REPO = "spronta/crawlie";

function newer(latest: string, current: string): boolean {
  const a = latest.split(".").map((n) => parseInt(n, 10) || 0);
  const b = current.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** Checks GitHub for a newer release on launch and shows a dismissible banner.
 *  Local-first: a single unauthenticated version check, no backend, no account. */
export function UpdateBanner() {
  const [info, setInfo] = useState<{ version: string; url: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const current = await getVersion();
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!res.ok) return;
        const data = await res.json();
        const latest = String(data.tag_name || "").replace(/^v/, "");
        if (!cancelled && latest && newer(latest, current)) {
          setInfo({ version: latest, url: data.html_url });
        }
      } catch {
        // offline or rate-limited — silently skip
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info || dismissed) return null;
  return (
    <div className="update-banner">
      <span className="grow">
        <strong style={{ fontWeight: 500 }}>crawlie v{info.version}</strong> is available.
      </span>
      <a className="btn btn-sm btn-secondary" href={info.url} target="_blank" rel="noreferrer">
        Download <IconExternal size={13} />
      </a>
      <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Dismiss" onClick={() => setDismissed(true)}>
        <IconX size={14} />
      </button>
    </div>
  );
}
