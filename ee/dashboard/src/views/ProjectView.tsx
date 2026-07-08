import { useCallback, useEffect, useState } from "react";
import type { CrawlConfig } from "@ui/lib/types";
import { ScoreRing, SeverityBadge, Toggle, Spinner, IconBack, IconRefresh, IconTrash, IconExternal } from "@ui/components/ui";
import { CrawlingView, type Progress } from "@ui/views/CrawlingView";
import { openExternal } from "@platform/api";
import {
  getProject,
  updateProject,
  deleteProject,
  crawlProject,
  projectReports,
  projectTrend,
  SCHEDULE_LABEL,
  type Project,
  type Schedule,
  type TrendPoint,
} from "../cloud";
import type { ReportMeta } from "@ui/lib/types";
import { relTime, absDateTime } from "../format";
import { ExtractorEditor } from "../extraction";
import type { Extractor } from "../cloud";

export function ProjectView({
  id,
  onBack,
  onOpenReport,
}: {
  id: string;
  onBack: () => void;
  onOpenReport: (reportId: string) => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [crawling, setCrawling] = useState<Progress | null>(null);

  const refresh = useCallback(async () => {
    const [p, r, t] = await Promise.all([getProject(id), projectReports(id), projectTrend(id)]);
    setProject(p);
    setReports(r);
    setTrend(t);
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const crawlNow = useCallback(async () => {
    if (!project) return;
    setCrawling({ crawled: 0, discovered: 0, queued: 0, current: project.url });
    try {
      await crawlProject(id, (e) => {
        if (e.type === "progress")
          setCrawling({ crawled: e.crawled, discovered: e.discovered, queued: e.queued, current: e.current });
      });
      await refresh();
    } finally {
      setCrawling(null);
    }
  }, [id, project, refresh]);

  async function setSchedule(schedule: Schedule) {
    setProject(await updateProject(id, { schedule }));
  }
  async function setNotify(notify: boolean) {
    setProject(await updateProject(id, { notify }));
  }
  async function remove() {
    if (!confirm("Delete this project? Its crawl history is kept.")) return;
    await deleteProject(id);
    onBack();
  }

  if (crawling && project) {
    const cfg = { url: project.url } as CrawlConfig;
    return <CrawlingView config={cfg} progress={crawling} onCancel={() => setCrawling(null)} />;
  }
  if (!project) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
        <Spinner />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "28px 28px 60px", width: "100%" }}>
      <button className="btn btn-sm" onClick={onBack} style={{ marginBottom: 18 }}>
        <IconBack size={15} /> Projects
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>{project.name}</h1>
          <button className="linklike" onClick={() => openExternal(project.url)} style={urlLink}>
            {project.url} <IconExternal size={12} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-primary" onClick={crawlNow}>
            <IconRefresh size={15} /> Crawl now
          </button>
          <button className="btn" onClick={remove} title="Delete project">
            <IconTrash size={15} />
          </button>
        </div>
      </div>

      {/* Latest + schedule */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 14, marginTop: 22 }}>
        <div style={panel}>
          <div style={panelTitle}>Latest health</div>
          {project.lastHealth != null ? (
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <ScoreRing value={project.lastHealth} size={84} />
              <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                <div>Crawled {project.lastCrawlAt ? relTime(project.lastCrawlAt) : "—"}</div>
                {project.lastReport && (
                  <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => onOpenReport(project.lastReport!)}>
                    View report
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p style={{ color: "var(--text-secondary)" }}>No crawls yet — hit “Crawl now”.</p>
          )}
        </div>

        <div style={panel}>
          <div style={panelTitle}>Monitoring</div>
          <label style={row}>
            <span>Schedule</span>
            <select value={project.schedule} onChange={(e) => setSchedule(e.target.value as Schedule)} style={select}>
              {(Object.keys(SCHEDULE_LABEL) as Schedule[]).map((s) => (
                <option key={s} value={s}>
                  {SCHEDULE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <div style={{ padding: "8px 0" }}>
            <Toggle on={project.notify} onChange={setNotify} label="Email me on regressions" />
          </div>
          {project.schedule !== "off" && project.nextRunAt && (
            <div style={{ color: "var(--text-secondary)", fontSize: 12.5, marginTop: 4 }}>
              Next crawl {relTime(project.nextRunAt)}
            </div>
          )}
        </div>
      </div>

      {/* Custom extraction */}
      <div style={{ ...panel, marginTop: 14 }}>
        <div style={panelTitle}>Custom extraction</div>
        <ExtractorEditor
          value={(project.config?.extract as Extractor[]) ?? []}
          onSave={async (rows) => {
            const p = await updateProject(id, { config: { ...(project.config ?? {}), extract: rows } });
            setProject(p);
          }}
        />
      </div>

      {/* Trend */}
      {trend.length > 1 && (
        <div style={{ ...panel, marginTop: 14 }}>
          <div style={panelTitle}>Health over time</div>
          <Sparkline points={trend.map((t) => t.health)} />
        </div>
      )}

      {/* History */}
      <div style={{ ...panel, marginTop: 14 }}>
        <div style={panelTitle}>History</div>
        {reports.length === 0 ? (
          <p style={{ color: "var(--text-secondary)" }}>No crawls yet.</p>
        ) : (
          <div>
            {reports.map((r) => (
              <button key={r.id} style={histRow} onClick={() => onOpenReport(r.id)}>
                <span style={{ color: "var(--text-secondary)", fontSize: 13, width: 150 }}>{absDateTime(r.createdAt)}</span>
                <ScoreRing value={r.healthScore} size={30} stroke={4} />
                <span style={{ display: "flex", gap: 6 }}>
                  {r.errors > 0 && <SeverityBadge severity="error" count={r.errors} />}
                  {r.warnings > 0 && <SeverityBadge severity="warning" count={r.warnings} />}
                </span>
                <span style={{ marginLeft: "auto", color: "var(--text-secondary)", fontSize: 12.5 }}>{r.totalPages} pages</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const w = 600;
  const h = 60;
  const max = Math.max(100, ...points);
  const min = Math.min(0, ...points);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const y = (v: number) => h - ((v - min) / (max - min || 1)) * h;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: "block" }}>
      <path d={d} fill="none" stroke="var(--blue, #0055ee)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <circle cx={(points.length - 1) * step} cy={y(last)} r={3} fill="var(--blue, #0055ee)" />
    </svg>
  );
}

const panel: React.CSSProperties = { background: "var(--panel, var(--bg))", border: "1px solid var(--border)", borderRadius: 12, padding: 18 };
const panelTitle: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-secondary)", marginBottom: 14 };
const row: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 0", fontSize: 14 };
const select: React.CSSProperties = { height: 36, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-soft, var(--bg))", color: "var(--text)", cursor: "pointer", fontSize: 13.5 };
const urlLink: React.CSSProperties = { background: "none", border: 0, padding: 0, color: "var(--link, #3b9eff)", cursor: "pointer", fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 5 };
const histRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left", background: "none", border: 0, borderTop: "1px solid var(--border-soft, var(--border))", padding: "12px 4px", cursor: "pointer", color: "var(--text)" };
