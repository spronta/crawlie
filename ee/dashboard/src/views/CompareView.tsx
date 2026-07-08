// Audit comparison (Sitebulb-style "Compare Audits" / "Lost and Found"):
// pick any two crawls of a project and see score deltas, new vs resolved
// issues, and pages that appeared or disappeared.

import { useCallback, useEffect, useState } from "react";
import type { CrawlDiff, IssueDelta, ReportMeta } from "@ui/lib/types";
import { CATEGORY_LABELS } from "@ui/lib/types";
import { SeverityBadge, Spinner } from "@ui/components/ui";
import { diffReports } from "../cloud";
import { absDateTime } from "../format";
import { Card } from "../kit";

export function CompareView({ reports }: { reports: ReportMeta[] }) {
  // Reports arrive newest-first; default to comparing the latest two.
  const [newId, setNewId] = useState(reports[0]?.id ?? "");
  const [oldId, setOldId] = useState(reports[1]?.id ?? "");
  const [diff, setDiff] = useState<CrawlDiff | null | undefined>(undefined);

  const load = useCallback(async () => {
    if (!oldId || !newId || oldId === newId) return setDiff(null);
    setDiff(undefined);
    try {
      setDiff(await diffReports(oldId, newId));
    } catch {
      setDiff(import.meta.env.DEV ? MOCK_DIFF : null);
    }
  }, [oldId, newId]);
  useEffect(() => { load(); }, [load]);

  if (reports.length < 2) {
    return (
      <Card title="Compare audits">
        <p style={{ color: "var(--text-secondary)", margin: 0 }}>
          Run at least two crawls to compare them — every scheduled or manual crawl lands here.
        </p>
      </Card>
    );
  }

  const pick = (value: string, set: (v: string) => void, exclude: string) => (
    <select value={value} onChange={(e) => set(e.target.value)} style={select}>
      {reports.filter((r) => r.id !== exclude).map((r) => (
        <option key={r.id} value={r.id}>
          {absDateTime(r.createdAt)} · {r.totalPages} pages · health {r.healthScore}
        </option>
      ))}
    </select>
  );

  const unchanged =
    diff &&
    diff.healthDelta === 0 &&
    diff.newIssues.length === 0 &&
    diff.resolvedIssues.length === 0 &&
    diff.pagesAdded.length === 0 &&
    diff.pagesRemoved.length === 0;

  return (
    <>
      <Card title="Compare audits">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {pick(oldId, setOldId, newId)}
          <span style={{ color: "var(--text-tertiary)", fontSize: 13, flex: "0 0 auto" }}>→</span>
          {pick(newId, setNewId, oldId)}
        </div>
      </Card>

      {diff === undefined && (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner /></div>
      )}
      {diff === null && (
        <Card title="No comparison">
          <p style={{ color: "var(--text-secondary)", margin: 0 }}>Pick two different audits to compare.</p>
        </Card>
      )}

      {diff && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
            <ScoreDelta label="Health" before={diff.healthBefore} after={diff.healthAfter} />
            <ScoreDelta label="GEO" before={diff.geoBefore} after={diff.geoAfter} />
            <ScoreDelta label="Accessibility" before={diff.a11yBefore} after={diff.a11yAfter} />
            <ScoreDelta label="Pages" before={diff.pagesBefore} after={diff.pagesAfter} raw />
          </div>

          {unchanged && (
            <Card title="No changes">
              <p style={{ color: "var(--text-secondary)", margin: 0 }}>
                Nothing regressed and nothing was fixed between these two audits.
              </p>
            </Card>
          )}

          {diff.newIssues.length > 0 && (
            <Card title={`Regressed — new issues (${diff.newIssues.length})`}>
              {diff.newIssues.map((d) => <DeltaRow key={d.rule} d={d} tone="bad" />)}
            </Card>
          )}
          {diff.resolvedIssues.length > 0 && (
            <Card title={`Fixed — resolved issues (${diff.resolvedIssues.length})`}>
              {diff.resolvedIssues.map((d) => <DeltaRow key={d.rule} d={d} tone="good" />)}
            </Card>
          )}

          {diff.pagesAdded.length > 0 && (
            <UrlListCard title={`Pages found (${diff.pagesAdded.length})`} urls={diff.pagesAdded} />
          )}
          {diff.pagesRemoved.length > 0 && (
            <UrlListCard title={`Pages lost (${diff.pagesRemoved.length})`} urls={diff.pagesRemoved} />
          )}
        </>
      )}
    </>
  );
}

function ScoreDelta({ label, before, after, raw }: { label: string; before: number; after: number; raw?: boolean }) {
  const delta = after - before;
  const color = delta > 0 ? "var(--green-text, #3ddc91)" : delta < 0 ? "var(--red-text, #ff6166)" : "var(--text-tertiary)";
  return (
    <div style={{ background: "var(--panel, var(--bg))", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-secondary)", marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{after}{raw ? "" : ""}</span>
        <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>from {before}</span>
        <span style={{ marginLeft: "auto", color, fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0"}
        </span>
      </div>
    </div>
  );
}

function DeltaRow({ d, tone }: { d: IssueDelta; tone: "bad" | "good" }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: "1px solid var(--border-soft, var(--border))" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "none", border: 0, padding: "10px 4px", cursor: "pointer", color: "var(--text)" }}
      >
        <SeverityBadge severity={d.severity} />
        <span style={{ fontSize: 13.5, fontWeight: 500 }}>{d.title}</span>
        <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>{CATEGORY_LABELS[d.category]}</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono, monospace)", fontSize: 12.5, color: tone === "bad" ? "var(--red-text, #ff6166)" : "var(--green-text, #3ddc91)", flex: "0 0 auto" }}>
          {tone === "bad" ? "+" : "−"}{d.count} URL{d.count === 1 ? "" : "s"}
        </span>
      </button>
      {open && d.sampleUrls.length > 0 && (
        <div style={{ padding: "0 4px 10px 34px", display: "grid", gap: 3 }}>
          {d.sampleUrls.map((u) => (
            <span key={u} style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function UrlListCard({ title, urls }: { title: string; urls: string[] }) {
  const CAP = 50;
  return (
    <Card title={title}>
      <div style={{ display: "grid", gap: 4 }}>
        {urls.slice(0, CAP).map((u) => (
          <span key={u} style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u}</span>
        ))}
        {urls.length > CAP && <span style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>+ {urls.length - CAP} more</span>}
      </div>
    </Card>
  );
}

const select: React.CSSProperties = {
  flex: "1 1 220px",
  minWidth: 0,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--panel, var(--bg))",
  color: "var(--text)",
  fontSize: 13,
  cursor: "pointer",
};

// DEV-only preview (API unreachable in local dev).
const MOCK_DIFF: CrawlDiff = {
  oldId: "r1",
  newId: "r0",
  oldCreatedAt: Date.now() - 7 * 86_400_000,
  newCreatedAt: Date.now(),
  healthBefore: 62,
  healthAfter: 71,
  healthDelta: 9,
  geoBefore: 58,
  geoAfter: 64,
  geoDelta: 6,
  a11yBefore: 91,
  a11yAfter: 89,
  a11yDelta: -2,
  pagesBefore: 40,
  pagesAfter: 42,
  pagesAdded: ["https://crawlie.dev/docs/new-page", "https://crawlie.dev/changelog/0.5.4"],
  pagesRemoved: ["https://crawlie.dev/old-page"],
  newIssues: [
    { rule: "broken-link", title: "Broken Link", category: "links", severity: "error", count: 2, sampleUrls: ["https://crawlie.dev/docs/cli"] },
  ],
  resolvedIssues: [
    { rule: "description-missing", title: "Missing Meta Description", category: "titles-meta", severity: "warning", count: 5, sampleUrls: ["https://crawlie.dev/compare"] },
  ],
};
