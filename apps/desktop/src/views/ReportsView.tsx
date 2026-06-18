import { useEffect, useState } from "react";
import type { ReportMeta } from "../lib/types";
import { deleteReport, listReports, loadReport } from "../lib/api";
import { IconBack, IconHistory, IconTrash } from "../components/ui";
import type { CrawlResult } from "../lib/types";

export function ReportsView({ onBack, onOpen }: { onBack: () => void; onOpen: (r: CrawlResult) => void }) {
  const [reports, setReports] = useState<ReportMeta[] | null>(null);

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
    refresh();
  }

  return (
    <div className="section-gap" style={{ maxWidth: 860, margin: "0 auto" }}>
      <div className="row between">
        <h1 className="h1">Saved reports</h1>
        <button className="btn btn-secondary btn-sm" onClick={onBack}><IconBack size={15} /> Back</button>
      </div>

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
          {reports.map((r) => (
            <div className="report-row" key={r.id} onClick={() => open(r.id)}>
              <div className="col" style={{ gap: 3, minWidth: 0 }}>
                <span className="ru">{hostOf(r.url)}</span>
                <span className="rd">{fmtDate(r.createdAt)} · {r.totalPages} pages · {r.errors} errors</span>
              </div>
              <Score label="Health" value={r.healthScore} />
              <Score label="GEO" value={r.geoScore} />
              <button className="icon-btn" title="Delete" onClick={(e) => remove(e, r.id)}><IconTrash size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}
