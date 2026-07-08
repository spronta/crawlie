import { useEffect, useState } from "react";
import { ScoreRing, IconGlobe, IconSpark, Spinner } from "@ui/components/ui";
import { listProjects, createProject, SCHEDULE_LABEL, type Project, type Schedule } from "../cloud";
import { relTime, relFuture } from "../format";
import { toast } from "../ui-kit";

export function ProjectsView({ onOpen }: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [url, setUrl] = useState("");
  const [schedule, setSchedule] = useState<Schedule>("weekly");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    try {
      const p = await createProject({ url: url.trim(), schedule });
      toast("Project created — crawling now", "success");
      onOpen(p.id);
    } catch (err) {
      toast((err as Error).message, "error");
      setBusy(false);
    }
  }

  return (
    <div className="view">
      <header className="view-bar">
        <div style={{ minWidth: 0 }}>
          <h1>Projects</h1>
          <p className="sub">Save a site, crawl it on a schedule, and get alerted when your SEO regresses.</p>
        </div>
        {!showNew && (
          <button className="btn btn-primary" onClick={() => setShowNew(true)} style={{ flex: "0 0 auto" }}>
            <IconSpark size={15} /> New project
          </button>
        )}
      </header>

      <div className="view-body">
        <div className="view-body-inner">
          {showNew && (
            <form onSubmit={create} className="card card-pad" style={{ marginBottom: "var(--sp-4)" }}>
              <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                <input
                  autoFocus
                  className="input"
                  style={{ flex: "1 1 260px" }}
                  type="url"
                  placeholder="https://yoursite.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
                <select className="input" style={{ cursor: "pointer", flex: "0 0 auto" }} value={schedule} onChange={(e) => setSchedule(e.target.value as Schedule)}>
                  {(Object.keys(SCHEDULE_LABEL) as Schedule[]).map((s) => (
                    <option key={s} value={s}>{SCHEDULE_LABEL[s]}</option>
                  ))}
                </select>
                <button className="btn btn-primary" type="submit" disabled={busy}>
                  {busy ? <Spinner /> : "Create + crawl"}
                </button>
                <button className="btn" type="button" onClick={() => setShowNew(false)}>Cancel</button>
              </div>
              <p className="muted" style={{ font: "var(--copy-13)", margin: "10px 2px 0" }}>
                We'll run the first crawl now, then re-crawl on the schedule you pick.
              </p>
            </form>
          )}

          {projects === null ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner /></div>
          ) : projects.length === 0 && !showNew ? (
            <div className="proj-empty">
              <div style={{ display: "flex", justifyContent: "center", color: "var(--text-tertiary)" }}><IconGlobe size={30} /></div>
              <p className="muted" style={{ margin: "14px 0 18px", font: "var(--copy-14)" }}>No projects yet. Add a site to start monitoring it.</p>
              <button className="btn btn-primary" onClick={() => setShowNew(true)}>Add your first site</button>
            </div>
          ) : (
            <div className="proj-grid">
              {projects.map((p) => <ProjectCard key={p.id} p={p} onOpen={onOpen} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ p, onOpen }: { p: Project; onOpen: (id: string) => void }) {
  const scheduled = p.schedule !== "off";
  return (
    <button className="proj-card" onClick={() => onOpen(p.id)}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
        <img
          className="proj-fav"
          src={faviconUrl(p.url)}
          alt=""
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="proj-name">{p.name}</div>
          <div className="proj-url">{hostOf(p.url)}</div>
        </div>
        {p.lastHealth != null
          ? <ScoreRing value={p.lastHealth} size={42} stroke={5} />
          : <span className="proj-nohealth">—</span>}
      </div>
      <div className="proj-foot">
        <span className={`sched-pill${scheduled ? " on" : ""}`}>{SCHEDULE_LABEL[p.schedule]}</span>
        <span className="proj-meta">
          {p.lastCrawlAt ? `Crawled ${relTime(p.lastCrawlAt)}` : "Not crawled yet"}
          {scheduled && p.nextRunAt ? ` · next ${relFuture(p.nextRunAt)}` : ""}
        </span>
      </div>
    </button>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; }
}
function faviconUrl(url: string): string {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).host}&sz=64`; } catch { return ""; }
}
