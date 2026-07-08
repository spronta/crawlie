// Redirects tab — every redirecting URL and its full hop chain (Sitebulb has a
// dedicated Redirects category; the engine captures the chain per page).

interface Redirect {
  from: string;
  to: string;
  status: number;
}
interface Pg {
  url: string;
  finalUrl?: string;
  status: number;
  redirectChain?: Redirect[];
}

function short(u: string): string {
  try {
    const url = new URL(u);
    return url.pathname === "/" ? url.host : url.host + url.pathname + url.search;
  } catch {
    return u;
  }
}

function statusColor(s: number): string {
  if (s >= 200 && s < 300) return "var(--green, #3ddc91)";
  if (s >= 300 && s < 400) return "var(--amber, #f5b544)";
  return "var(--red, #ff6166)";
}

export function Redirects({ pages }: { pages: unknown }) {
  const ps = (pages as Pg[] | undefined) ?? [];
  const rows = ps.filter((p) => (p.redirectChain?.length ?? 0) > 0);

  if (rows.length === 0) {
    return <div style={{ padding: "24px 20px", color: "var(--text-secondary)" }}>No redirects found — every URL resolved directly.</div>;
  }

  const permanent = rows.filter((p) => p.redirectChain!.some((r) => r.status === 301)).length;
  const temporary = rows.filter((p) => p.redirectChain!.every((r) => r.status !== 301)).length;
  const chains = rows.filter((p) => (p.redirectChain?.length ?? 0) > 1).length;

  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <Stat label="Redirecting URLs" value={rows.length} />
        <Stat label="Permanent (301)" value={permanent} />
        <Stat label="Temporary (302/307)" value={temporary} />
        <Stat label="Redirect chains (2+ hops)" value={chains} tone={chains > 0 ? "warn" : undefined} />
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>Source URL</th>
              <th style={th}>Redirect path</th>
              <th style={th}>Final URL</th>
              <th style={{ ...th, textAlign: "right" }}>Hops</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const chain = p.redirectChain ?? [];
              const codes = [...chain.map((r) => r.status), p.status];
              return (
                <tr key={p.url}>
                  <td style={{ ...td, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--link, #3b9eff)" }} title={p.url}>{short(p.url)}</td>
                  <td style={td}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {codes.map((c, i) => (
                        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11.5, fontWeight: 600, color: statusColor(c), border: `1px solid ${statusColor(c)}`, borderRadius: 5, padding: "1px 5px" }}>{c}</span>
                          {i < codes.length - 1 && <span style={{ color: "var(--text-secondary)" }}>→</span>}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td style={{ ...td, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-secondary)" }} title={p.finalUrl}>{p.finalUrl ? short(p.finalUrl) : "—"}</td>
                  <td style={{ ...td, textAlign: "right", color: chain.length > 1 ? "var(--amber, #f5b544)" : "var(--text-secondary)" }}>{chain.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div style={{ background: "var(--panel, var(--bg))", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", minWidth: 120 }}>
      <div style={{ fontSize: 20, fontWeight: 650, color: tone === "warn" && value > 0 ? "var(--amber, #f5b544)" : "var(--text)" }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "9px 12px", borderBottom: "1px solid var(--border)", background: "var(--panel-2, transparent)", fontWeight: 600, whiteSpace: "nowrap", position: "sticky", top: 0 };
const td: React.CSSProperties = { padding: "9px 12px", borderBottom: "1px solid var(--border-soft, var(--border))", verticalAlign: "top" };
