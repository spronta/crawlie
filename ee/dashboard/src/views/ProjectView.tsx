import { useCallback, useEffect, useState } from "react";
import type { CrawlConfig } from "@ui/lib/types";
import { ScoreRing, SeverityBadge, Toggle, Spinner, IconBack, IconRefresh, IconTrash, IconExternal } from "@ui/components/ui";
import { CrawlingView, type Progress } from "@ui/views/CrawlingView";
import { openExternal } from "@platform/api";
import {
  getProject, updateProject, deleteProject, crawlProject, projectReports, projectTrend,
  SCHEDULE_LABEL, type Project, type Schedule, type TrendPoint, type Extractor,
} from "../cloud";
import type { ReportMeta } from "@ui/lib/types";
import { relTime, absDateTime } from "../format";
import { ExtractorEditor } from "../extraction";
import { toast, confirmDialog } from "../ui-kit";
import { Card, Tabs, Field, fieldInput } from "../kit";

export function ProjectView({ id, onBack, onOpenReport }: { id: string; onBack: () => void; onOpenReport: (reportId: string) => void }) {
  const [project, setProject] = useState<Project | null>(null);
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [crawling, setCrawling] = useState<Progress | null>(null);
  const [tab, setTab] = useState("overview");

  const refresh = useCallback(async () => {
    try {
      const [p, r, t] = await Promise.all([getProject(id), projectReports(id), projectTrend(id)]);
      setProject(p);
      setReports(r);
      setTrend(t);
    } catch {
      if (import.meta.env.DEV) { setProject(MOCK_PROJECT(id)); setReports(MOCK_REPORTS); setTrend(MOCK_TREND); }
    }
  }, [id]);
  useEffect(() => { refresh(); }, [refresh]);

  const crawlNow = useCallback(async () => {
    if (!project) return;
    setCrawling({ crawled: 0, discovered: 0, queued: 0, current: project.url });
    try {
      await crawlProject(id, (e) => {
        if (e.type === "progress") setCrawling({ crawled: e.crawled, discovered: e.discovered, queued: e.queued, current: e.current });
      });
      toast("Crawl complete", "success");
      await refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setCrawling(null);
    }
  }, [id, project, refresh]);

  const patch = async (p: Parameters<typeof updateProject>[1]) => setProject(await updateProject(id, p));
  async function remove() {
    if (!(await confirmDialog("Delete this project?", { detail: "Its crawl history is kept, but the project and its schedule are removed.", danger: true, confirmLabel: "Delete project" }))) return;
    await deleteProject(id);
    toast("Project deleted", "success");
    onBack();
  }

  if (crawling && project) {
    return <CrawlingView config={{ url: project.url } as CrawlConfig} progress={crawling} onCancel={() => setCrawling(null)} />;
  }
  if (!project) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 80 }}><Spinner /></div>;
  }

  const hasContentTrend = trend.filter((t) => t.packScore != null).length > 1;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Sticky top bar */}
      <div style={topBar}>
        <button className="btn btn-sm" onClick={onBack} style={{ flex: "0 0 auto" }}><IconBack size={15} /> Projects</button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 650, color: "var(--heading, var(--text))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{project.name}</div>
          <button className="linklike" onClick={() => openExternal(project.url)} style={urlLink}>{project.url} <IconExternal size={11} /></button>
        </div>
        <button className="btn btn-primary" onClick={crawlNow} style={{ flex: "0 0 auto" }}><IconRefresh size={15} /> Crawl now</button>
        <button className="btn" onClick={remove} title="Delete project" style={{ flex: "0 0 auto" }}><IconTrash size={15} /></button>
      </div>

      {/* Tabs */}
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "history", label: "History", badge: reports.length },
          { id: "settings", label: "Settings" },
          { id: "extraction", label: "Extraction" },
        ]}
      />

      {/* Scrolling content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 28px 60px", width: "100%", display: "grid", gap: 14 }}>
          {tab === "overview" && (
            <>
              <Card title="Latest crawl">
                {project.lastHealth != null ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
                    <ScoreRing value={project.lastHealth} size={92} />
                    <div style={{ color: "var(--text-secondary)", fontSize: 13.5 }}>
                      <div>Crawled {project.lastCrawlAt ? relTime(project.lastCrawlAt) : "—"}</div>
                      {project.schedule !== "off" && project.nextRunAt && <div style={{ marginTop: 2 }}>Next crawl {relTime(project.nextRunAt)}</div>}
                      {project.lastReport && <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => onOpenReport(project.lastReport!)}>View report →</button>}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-secondary)" }}>
                    <p style={{ margin: "0 0 14px" }}>No crawls yet.</p>
                    <button className="btn btn-primary btn-sm" onClick={crawlNow}><IconRefresh size={14} /> Run first crawl</button>
                  </div>
                )}
              </Card>
              {trend.length > 1 && (
                <Card title="Health over time">
                  <Sparkline points={trend.map((t) => t.health)} max={100} />
                </Card>
              )}
              {hasContentTrend && (
                <Card title="Content-rule violations over time (lower is better)">
                  <Sparkline points={trend.map((t) => t.packScore ?? 0)} color="var(--red-text, #ff6166)" />
                </Card>
              )}
              {reports.length > 0 && (
                <Card
                  title="Recent audits"
                  right={reports.length > 5 ? <button className="linklike" style={{ fontSize: 13 }} onClick={() => setTab("history")}>View all {reports.length} →</button> : undefined}
                >
                  {reports.slice(0, 5).map((r) => <AuditRow key={r.id} r={r} onOpen={onOpenReport} />)}
                </Card>
              )}
            </>
          )}

          {tab === "history" && (
            <Card title={`All audits${reports.length ? ` (${reports.length})` : ""}`}>
              {reports.length === 0 ? (
                <p style={{ color: "var(--text-secondary)", margin: 0 }}>No audits yet — run a crawl to see it here.</p>
              ) : (
                reports.map((r) => <AuditRow key={r.id} r={r} onOpen={onOpenReport} />)
              )}
            </Card>
          )}

          {tab === "settings" && (
            <>
              <Card title="Monitoring">
                <div style={{ display: "grid", gap: 16 }}>
                  <Field label="Schedule">
                    <select value={project.schedule} onChange={(e) => patch({ schedule: e.target.value as Schedule })} style={{ ...fieldInput, cursor: "pointer" }}>
                      {(Object.keys(SCHEDULE_LABEL) as Schedule[]).map((s) => <option key={s} value={s}>{SCHEDULE_LABEL[s]}</option>)}
                    </select>
                  </Field>
                  <Toggle on={project.notify} onChange={(v) => patch({ notify: v })} label="Email me on regressions" />
                  <Field label="Alert webhook (Slack / Discord)" hint="Posts a message when a scheduled crawl regresses.">
                    <input style={{ ...fieldInput, fontFamily: "var(--font-mono, monospace)", fontSize: 12.5 }} placeholder="https://hooks.slack.com/services/…" defaultValue={project.notifyWebhook ?? ""} onBlur={(e) => { if ((e.target.value.trim() || null) !== project.notifyWebhook) patch({ notifyWebhook: e.target.value.trim() || null }); }} />
                  </Field>
                </div>
              </Card>
              <Card title="Crawl settings">
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <Field label="Max pages">
                    <input type="number" min={1} style={{ ...fieldInput, width: 120 }} defaultValue={Number(project.config?.maxPages ?? 500)} onBlur={(e) => { const v = Math.max(1, Number(e.target.value) || 500); if (v !== (project.config?.maxPages ?? 500)) patch({ config: { ...(project.config ?? {}), maxPages: v } }); }} />
                  </Field>
                  <Field label="Max depth">
                    <input type="number" min={0} style={{ ...fieldInput, width: 120 }} defaultValue={Number(project.config?.maxDepth ?? 16)} onBlur={(e) => { const v = Math.max(0, Number(e.target.value) || 16); if (v !== (project.config?.maxDepth ?? 16)) patch({ config: { ...(project.config ?? {}), maxDepth: v } }); }} />
                  </Field>
                </div>
              </Card>
            </>
          )}

          {tab === "extraction" && (
            <Card title="Custom extraction">
              <ExtractorEditor
                value={(project.config?.extract as Extractor[]) ?? []}
                onSave={async (rows) => { await patch({ config: { ...(project.config ?? {}), extract: rows } }); toast("Extraction saved", "success"); }}
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function AuditRow({ r, onOpen }: { r: ReportMeta; onOpen: (id: string) => void }) {
  return (
    <button style={histRow} onClick={() => onOpen(r.id)}>
      <span style={{ color: "var(--text-secondary)", fontSize: 13, width: 150, flex: "0 0 auto" }}>{absDateTime(r.createdAt)}</span>
      <ScoreRing value={r.healthScore} size={30} stroke={4} />
      <span style={{ display: "flex", gap: 6 }}>
        {r.errors > 0 && <SeverityBadge severity="error" count={r.errors} />}
        {r.warnings > 0 && <SeverityBadge severity="warning" count={r.warnings} />}
      </span>
      <span style={{ marginLeft: "auto", color: "var(--text-secondary)", fontSize: 12.5 }}>{r.totalPages} pages</span>
    </button>
  );
}

function Sparkline({ points, max, color = "var(--blue, #0055ee)" }: { points: number[]; max?: number; color?: string }) {
  const w = 600, h = 60;
  const hi = max ?? Math.max(...points, 1);
  const lo = Math.min(...points, 0);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const y = (v: number) => h - ((v - lo) / (hi - lo || 1)) * h;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: "block" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <circle cx={(points.length - 1) * step} cy={y(last)} r={3} fill={color} />
    </svg>
  );
}

// DEV-only preview data (used when the API isn't reachable in local dev).
const DAY = 86_400_000;
const MOCK_PROJECT = (id: string): Project => ({ id, name: "crawlie.dev", url: "https://crawlie.dev", config: { maxPages: 500, maxDepth: 16 }, schedule: "weekly", notify: true, notifyWebhook: null, nextRunAt: Date.now() + 7 * DAY, lastCrawlAt: Date.now() - 8 * 3600_000, lastHealth: 69, lastReport: "demo", createdAt: Date.now() - 30 * DAY });
const MOCK_REPORTS: ReportMeta[] = [0, 1, 2, 3].map((i) => ({ id: `r${i}`, url: "https://crawlie.dev", createdAt: Date.now() - i * 7 * DAY, totalPages: 42 - i, errors: i, warnings: 3 + i, healthScore: 69 - i * 3, geoScore: 60, a11yScore: 90 }));
const MOCK_TREND: TrendPoint[] = [0, 1, 2, 3].map((i) => ({ id: `r${i}`, at: Date.now() - (3 - i) * 7 * DAY, health: 60 + i * 3, geo: 60, a11y: 90, errors: 3 - i, warnings: 4, pages: 40, packScore: 8 - i * 2 }));

const topBar: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "var(--panel, var(--bg))", flex: "0 0 auto" };
const urlLink: React.CSSProperties = { background: "none", border: 0, padding: 0, color: "var(--link, #3b9eff)", cursor: "pointer", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const histRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left", background: "none", border: 0, borderTop: "1px solid var(--border-soft, var(--border))", padding: "12px 4px", cursor: "pointer", color: "var(--text)" };
