import { useEffect, useState } from "react";
import { ScoreRing, IconGlobe, IconSpark, Spinner } from "@ui/components/ui";
import { listProjects, createProject, SCHEDULE_LABEL, type Project, type Schedule } from "../cloud";
import { relTime } from "../format";
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
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "40px 28px", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <h1 style={{ fontSize: 26, margin: 0 }}>Projects</h1>
        {!showNew && (
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            <IconSpark size={15} /> New project
          </button>
        )}
      </div>
      <p style={{ color: "var(--text-secondary)", marginTop: 0, marginBottom: 24 }}>
        Save a site, crawl it on a schedule, and get alerted when your SEO regresses.
      </p>

      {showNew && (
        <form onSubmit={create} style={newCard}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              autoFocus
              style={{ ...input, flex: "1 1 260px" }}
              type="url"
              placeholder="https://yoursite.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <select style={select} value={schedule} onChange={(e) => setSchedule(e.target.value as Schedule)}>
              {(Object.keys(SCHEDULE_LABEL) as Schedule[]).map((s) => (
                <option key={s} value={s}>
                  {SCHEDULE_LABEL[s]}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? <Spinner /> : "Create + crawl"}
            </button>
            <button className="btn" type="button" onClick={() => setShowNew(false)}>
              Cancel
            </button>
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: 12.5, margin: "10px 2px 0" }}>
            We'll run the first crawl now, then re-crawl on the schedule you pick.
          </p>
        </form>
      )}

      {projects === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
          <Spinner />
        </div>
      ) : projects.length === 0 && !showNew ? (
        <div style={empty}>
          <IconGlobe size={28} />
          <p style={{ margin: "12px 0 16px", color: "var(--text-secondary)" }}>
            No projects yet. Add a site to start monitoring it.
          </p>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            Add your first site
          </button>
        </div>
      ) : (
        <div style={grid}>
          {projects.map((p) => (
            <button key={p.id} style={card} onClick={() => onOpen(p.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {p.name}
                  </div>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {p.url}
                  </div>
                </div>
                {p.lastHealth != null && <ScoreRing value={p.lastHealth} size={44} stroke={6} />}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
                <span style={badge(p.schedule)}>{SCHEDULE_LABEL[p.schedule]}</span>
                <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                  {p.lastCrawlAt ? `crawled ${relTime(p.lastCrawlAt)}` : "not crawled yet"}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 };
const card: React.CSSProperties = { textAlign: "left", cursor: "pointer", background: "var(--panel, var(--bg))", border: "1px solid var(--border)", borderRadius: 12, padding: 18 };
const newCard: React.CSSProperties = { background: "var(--panel, var(--bg))", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 22 };
const empty: React.CSSProperties = { textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)", border: "1px dashed var(--border)", borderRadius: 12 };
const input: React.CSSProperties = { height: 42, padding: "0 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-soft, var(--bg))", color: "var(--text)", fontSize: 14 };
const select: React.CSSProperties = { ...input, cursor: "pointer" };
function badge(s: Schedule): React.CSSProperties {
  const on = s !== "off";
  return {
    fontSize: 11.5,
    fontWeight: 600,
    padding: "3px 9px",
    borderRadius: 999,
    background: on ? "color-mix(in srgb, var(--blue, #0055ee) 14%, transparent)" : "var(--panel-2, transparent)",
    color: on ? "var(--link, #3b9eff)" : "var(--text-secondary)",
    border: "1px solid var(--border)",
  };
}
