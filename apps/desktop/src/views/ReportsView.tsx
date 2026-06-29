import { useEffect, useState } from "react";
import type { CrawlDiff, IssueDelta, ReportMeta } from "../lib/types";
import { deleteReport, diffReports, listReports, loadReport } from "../lib/api";
import { IconBack, IconHistory, IconTrash, IconX, SeverityBadge } from "../components/ui";
import type { CrawlResult } from "../lib/types";

const IconCompare = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8h13l-3-3M21 16H8l3 3" />
  </svg>
);

export function ReportsView({ onBack, onOpen }: { onBack: () => void; onOpen: (r: CrawlResult) => void }) {
  const [reports, setReports] = useState<ReportMeta[] | null>(null);
  const [compare, setCompare] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [diff, setDiff] = useState<CrawlDiff | null>(null);
  const [diffing, setDiffing] = useState(false);

  async function refresh() {
    setReports(await listReports());
  }
  useEffect(() => {
    refresh();
  }, []);

  async function open(id: string) {
    const r = await loadReport(id);
    if (r) onOpen(r);
  }
  async function remove(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await deleteReport(id);
    setSelected((s) => s.filter((x) => x !== id));
    refresh();
  }

  function toggleCompare() {
    setCompare((c) => !c);
    setSelected([]);
    setDiff(null);
  }
  function rowClick(id: string) {
    if (!compare) {
      open(id);
      return;
    }
    setDiff(null);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)));
  }
  async function runDiff() {
    if (!reports || selected.length !== 2) return;
    const pair = reports.filter((r) => selected.includes(r.id)).sort((a, b) => a.createdAt - b.createdAt);
    setDiffing(true);
    setDiff(await diffReports(pair[0].id, pair[1].id));
    setDiffing(false);
  }

  const canDiff = selected.length === 2;

  return (
    <>
      <div className="report-bar">
        <div className="report-bar-inner crumbs-only">
          <div className="row between" style={{ alignItems: "center" }} data-tauri-drag-region>
            <h1 style={{ margin: 0, font: "var(--heading-16)", letterSpacing: "-0.01em" }}>Saved reports</h1>
            <div className="row" style={{ gap: 8 }}>
              {reports && reports.length >= 2 && (
                <button className={`btn btn-sm ${compare ? "btn-primary" : "btn-secondary"}`} onClick={toggleCompare}>
                  <IconCompare size={15} /> {compare ? "Cancel" : "Compare"}
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={onBack}><IconBack size={15} /> Back</button>
            </div>
          </div>
        </div>
      </div>
      <div className="report-body">
        <div className="section-gap" style={{ maxWidth: 860, margin: "0 auto", width: "100%", padding: "var(--sp-5)" }}>

      {compare && (
        <div className="card card-pad row between" style={{ alignItems: "center" }}>
          <span className="muted">
            {canDiff ? "Two crawls selected." : `Select two crawls to compare (${selected.length}/2).`}
          </span>
          <button className="btn btn-primary btn-sm" disabled={!canDiff || diffing} onClick={runDiff}>
            {diffing ? "Comparing…" : "Compare →"}
          </button>
        </div>
      )}

      {diff && <DiffPanel diff={diff} onClose={() => setDiff(null)} />}

      {reports === null ? (
        <div className="card card-pad tertiary" style={{ textAlign: "center" }}>Loading…</div>
      ) : reports.length === 0 ? (
        <div className="card card-pad col" style={{ alignItems: "center", gap: 12, padding: "48px 24px", textAlign: "center" }}>
          <span style={{ color: "var(--text-tertiary)" }}><IconHistory size={28} /></span>
          <span className="h3">No reports yet</span>
          <span className="muted" style={{ maxWidth: "40ch" }}>Every crawl is saved here automatically so you can revisit and compare audits over time.</span>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          {reports.map((r) => {
            const sel = selected.includes(r.id);
            return (
              <div className={`report-row${compare ? " compare" : ""}${compare && sel ? " selected" : ""}`} key={r.id} onClick={() => rowClick(r.id)}>
                {compare && (
                  <span className={`select-dot${sel ? " on" : ""}`} aria-hidden>
                    {sel && <IconCheck />}
                  </span>
                )}
                <div className="report-main">
                  <img
                    className="report-fav"
                    src={faviconUrl(r.url)}
                    alt=""
                    loading="lazy"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                  />
                  <div className="col" style={{ gap: 3, minWidth: 0 }}>
                    <span className="ru">{hostOf(r.url)}</span>
                    <span className="rd">{fmtDate(r.createdAt)} · {r.totalPages} pages · {r.errors} errors</span>
                  </div>
                </div>
                <Score label="Health" value={r.healthScore} />
                <Score label="GEO" value={r.geoScore} />
                <Score label="A11y" value={r.a11yScore} />
                {!compare && (
                  <button className="icon-btn" title="Delete" onClick={(e) => remove(e, r.id)}><IconTrash size={15} /></button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .report-row.selected { background: color-mix(in srgb, var(--blue, #3b9eff) 12%, transparent); }
        .select-dot {
          flex: none; width: 18px; height: 18px; border-radius: 50%;
          border: 1.5px solid var(--border); display: grid; place-items: center; color: #fff;
        }
        .select-dot.on { background: var(--blue, #3b9eff); border-color: var(--blue, #3b9eff); }
        .diff-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
        .delta-chip { font-family: var(--font-mono, monospace); font-size: 13px; font-weight: 600; padding: 1px 7px; border-radius: 999px; }
        .delta-up { color: var(--green-text); background: color-mix(in srgb, var(--green-text) 14%, transparent); }
        .delta-down { color: var(--red-text); background: color-mix(in srgb, var(--red-text) 14%, transparent); }
        .delta-flat { color: var(--text-tertiary); background: color-mix(in srgb, var(--text-tertiary) 12%, transparent); }
        .diff-list { display: flex; flex-direction: column; gap: 8px; }
        .diff-item { display: flex; align-items: center; gap: 8px; }
        .diff-url { font-family: var(--font-mono, monospace); font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      `}</style>
        </div>
      </div>
    </>
  );
}

function DiffPanel({ diff, onClose }: { diff: CrawlDiff; onClose: () => void }) {
  return (
    <div className="card card-pad col" style={{ gap: 18 }}>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div className="col" style={{ gap: 2 }}>
          <span className="h3">Comparison</span>
          <span className="rd">{fmtDate(diff.oldCreatedAt)} → {fmtDate(diff.newCreatedAt)}</span>
        </div>
        <button className="icon-btn" title="Close" onClick={onClose}><IconX size={15} /></button>
      </div>

      <div className="row" style={{ gap: 28, flexWrap: "wrap" }}>
        <DeltaStat label="Health" before={diff.healthBefore} after={diff.healthAfter} delta={diff.healthDelta} />
        <DeltaStat label="GEO" before={diff.geoBefore} after={diff.geoAfter} delta={diff.geoDelta} />
        <DeltaStat label="A11y" before={diff.a11yBefore} after={diff.a11yAfter} delta={diff.a11yDelta} />
        <DeltaStat label="Pages" before={diff.pagesBefore} after={diff.pagesAfter} delta={diff.pagesAfter - diff.pagesBefore} />
      </div>

      <div className="diff-cols">
        <DeltaList title="Resolved" items={diff.resolvedIssues} empty="Nothing resolved" />
        <DeltaList title="New issues" items={diff.newIssues} empty="No new issues" />
      </div>

      {(diff.pagesAdded.length > 0 || diff.pagesRemoved.length > 0) && (
        <div className="diff-cols">
          <PageList title={`Pages added (${diff.pagesAdded.length})`} urls={diff.pagesAdded} />
          <PageList title={`Pages removed (${diff.pagesRemoved.length})`} urls={diff.pagesRemoved} />
        </div>
      )}
    </div>
  );
}

function DeltaStat({ label, before, after, delta }: { label: string; before: number; after: number; delta: number }) {
  const cls = delta > 0 ? "delta-up" : delta < 0 ? "delta-down" : "delta-flat";
  const sign = delta > 0 ? "+" : "";
  return (
    <div className="col" style={{ gap: 4 }}>
      <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)" }}>{label}</span>
      <span className="row" style={{ gap: 8, alignItems: "baseline" }}>
        <span className="mono" style={{ color: "var(--text-tertiary)" }}>{before}</span>
        <span style={{ color: "var(--text-tertiary)" }}>→</span>
        <span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{after}</span>
        <span className={`delta-chip ${cls}`}>{sign}{delta}</span>
      </span>
    </div>
  );
}

function DeltaList({ title, items, empty }: { title: string; items: IssueDelta[]; empty: string }) {
  const total = items.reduce((n, i) => n + i.count, 0);
  return (
    <div className="col" style={{ gap: 10 }}>
      <span className="rd" style={{ fontWeight: 600 }}>{title} · {total}</span>
      {items.length === 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>{empty}</span>
      ) : (
        <div className="diff-list">
          {items.map((d) => (
            <div className="diff-item" key={d.rule}>
              <SeverityBadge severity={d.severity} />
              <span style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
              <span className="mono" style={{ color: "var(--text-tertiary)" }}>{d.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PageList({ title, urls }: { title: string; urls: string[] }) {
  return (
    <div className="col" style={{ gap: 8 }}>
      <span className="rd" style={{ fontWeight: 600 }}>{title}</span>
      <div className="diff-list">
        {urls.slice(0, 8).map((u) => (
          <span className="diff-url" key={u} title={u}>{pathOf(u)}</span>
        ))}
        {urls.length > 8 && <span className="muted" style={{ fontSize: 12 }}>+{urls.length - 8} more</span>}
      </div>
    </div>
  );
}

const IconCheck = () => (
  <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

function Score({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? "var(--green-text)" : value >= 50 ? "var(--amber-text)" : "var(--red-text)";
  return (
    <div className="mini-score" title={label}>
      <span className="c">{label}</span>
      <span className="v" style={{ color }}>{value}</span>
      <span className="c">/100</span>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
function faviconUrl(url: string): string {
  try {
    const host = new URL(url).host;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch {
    return "";
  }
}
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return (u.pathname + u.search) || "/";
  } catch {
    return url;
  }
}
function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}
