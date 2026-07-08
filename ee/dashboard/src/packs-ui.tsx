// Rule-pack violations panel for a report. Reads the `packs` object the
// container grafts onto the crawl result (byUrl ledgers + aggregate).

interface Hit {
  rule: string;
  points: number;
  evidence: string[];
}
interface Ledger {
  pack: string;
  score: number;
  hits: Hit[];
}
interface PackReport {
  totalScore: number;
  pagesFlagged: number;
  packNames: string[];
  byUrl: Record<string, { score: number; ledgers: Ledger[] }>;
}

export function PackViolations({ packs }: { packs: unknown }) {
  const p = packs as PackReport | null | undefined;
  if (!p || !p.byUrl) return null;
  const urls = Object.entries(p.byUrl).sort((a, b) => b[1].score - a[1].score);
  if (urls.length === 0) {
    return (
      <div style={wrap}>
        <div style={{ ...pill, color: "var(--green, #3ddc91)", borderColor: "color-mix(in srgb, var(--green,#3ddc91) 32%, transparent)" }}>
          ✓ No rule violations ({p.packNames?.join(", ")})
        </div>
      </div>
    );
  }
  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={title}>Content rules</div>
        <span style={{ ...pill, color: "var(--red-text, #ff6166)", borderColor: "color-mix(in srgb, var(--red,#ff6166) 32%, transparent)" }}>
          {p.pagesFlagged} page{p.pagesFlagged === 1 ? "" : "s"} · score {p.totalScore.toFixed(0)}
        </span>
        <span style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>{p.packNames?.join(", ")}</span>
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        {urls.map(([url, data]) => (
          <div key={url} style={{ borderTop: "1px solid var(--border-soft, var(--border))", padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 13, color: "var(--link, #3b9eff)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</div>
              <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12.5, color: "var(--red-text, #ff6166)", flex: "0 0 auto" }}>+{data.score.toFixed(0)}</div>
            </div>
            {data.ledgers.flatMap((l) => l.hits).map((h, i) => (
              <div key={i} style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 6 }}>
                <b style={{ color: "var(--text)" }}>{h.rule}</b> (+{h.points}) — {h.evidence.slice(0, 6).join(", ")}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = { padding: "16px 20px" };
const title: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-secondary)" };
const pill: React.CSSProperties = { fontSize: 12, fontWeight: 600, padding: "3px 9px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--panel-2, transparent)" };
