import type { CrawlConfig } from "../lib/types";
import { Spinner } from "../components/ui";
import { shortUrl } from "../lib/format";

export interface Progress {
  crawled: number;
  discovered: number;
  queued: number;
  current: string;
}

export function CrawlingView({
  config,
  progress,
  onCancel,
}: {
  config: CrawlConfig;
  progress: Progress;
  onCancel: () => void;
}) {
  const denom = Math.max(progress.discovered, progress.crawled, 1);
  const pct = Math.min(100, Math.round((progress.crawled / Math.min(denom, config.maxPages)) * 100));
  const verifying = progress.current.startsWith("Verifying");

  return (
    <div className="section-gap" style={{ maxWidth: 720, margin: "0 auto", paddingTop: "8vh" }}>
      <div className="col" style={{ gap: 8, alignItems: "center", textAlign: "center" }}>
        <div className="row" style={{ gap: 10 }}>
          <Spinner />
          <span className="h2">{verifying ? "Verifying links…" : "Crawling…"}</span>
        </div>
        <span className="mono muted" style={{ fontSize: 13 }}>{config.url}</span>
      </div>

      <div className="card card-pad section-gap">
        <div className="progress-track">
          <div className={`progress-fill ${verifying ? "indeterminate" : ""}`} style={verifying ? undefined : { width: `${pct}%` }} />
        </div>
        <div className="stats">
          <Metric label="Crawled" value={progress.crawled} />
          <Metric label="Discovered" value={progress.discovered} />
          <Metric label="Queued" value={progress.queued} />
        </div>
        <div className="row between" style={{ borderTop: "1px solid var(--border)", paddingTop: "var(--sp-4)" }}>
          <span className="mono tertiary" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
            {verifying ? progress.current : shortUrl(progress.current || config.url)}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <span className="k muted" style={{ font: "var(--label-13)" }}>{label}</span>
      <span className="mono" style={{ font: "var(--heading-24)" }}>{value}</span>
    </div>
  );
}
