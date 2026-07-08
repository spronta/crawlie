import { useEffect, useState } from "react";
import { IconBack, IconTrash, Spinner } from "@ui/components/ui";
import { listKeys, createKey, revokeKey, type ApiKeyMeta } from "../cloud";
import { relTime } from "../format";

export function AccountView({ email, onBack }: { email: string; onBack: () => void }) {
  const [keys, setKeys] = useState<ApiKeyMeta[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const refresh = () => listKeys().then(setKeys).catch(() => setKeys([]));
  useEffect(() => {
    refresh();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const k = await createKey(name.trim() || "CLI key");
      setFresh(k.key);
      setName("");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 28px 60px", width: "100%" }}>
      <button className="btn btn-sm" onClick={onBack} style={{ marginBottom: 18 }}>
        <IconBack size={15} /> Back
      </button>
      <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>Account</h1>
      <p style={{ color: "var(--text-secondary)", marginTop: 0 }}>{email}</p>

      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={panelTitle}>API keys</div>
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 0 }}>
          Authenticate the CLI, MCP server or CI as this account. Use it as{" "}
          <code style={code}>Authorization: Bearer crw_…</code> against{" "}
          <code style={code}>crawlie.app/v1</code>.
        </p>

        {fresh && (
          <div style={freshBox}>
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 6 }}>
              Copy your new key now — you won't see it again.
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code style={{ ...code, flex: 1, padding: "8px 10px", wordBreak: "break-all" }}>{fresh}</code>
              <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(fresh)}>Copy</button>
              <button className="btn btn-sm" onClick={() => setFresh(null)}>Done</button>
            </div>
          </div>
        )}

        <form onSubmit={create} style={{ display: "flex", gap: 8, margin: "14px 0" }}>
          <input
            style={input}
            placeholder="Key name (e.g. CI, laptop)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? <Spinner /> : "Create key"}
          </button>
        </form>

        {keys === null ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 20 }}><Spinner /></div>
        ) : keys.length === 0 ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>No keys yet.</p>
        ) : (
          keys.map((k) => (
            <div key={k.id} style={keyRow}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{k.name}</div>
                <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>
                  <code style={code}>{k.prefix}…</code> · created {relTime(k.createdAt)}
                  {k.lastUsedAt ? ` · used ${relTime(k.lastUsedAt)}` : " · never used"}
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => revokeKey(k.id).then(refresh)} title="Revoke">
                <IconTrash size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const panel: React.CSSProperties = { background: "var(--panel, var(--bg))", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginTop: 20 };
const panelTitle: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-secondary)", marginBottom: 10 };
const input: React.CSSProperties = { flex: 1, height: 40, padding: "0 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-soft, var(--bg))", color: "var(--text)", fontSize: 14 };
const code: React.CSSProperties = { fontFamily: "var(--font-mono, monospace)", fontSize: 12, background: "var(--panel-2, transparent)", padding: "1px 5px", borderRadius: 5, border: "1px solid var(--border-soft, var(--border))" };
const freshBox: React.CSSProperties = { background: "color-mix(in srgb, var(--green, #3ddc91) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--green, #3ddc91) 32%, transparent)", borderRadius: 10, padding: 12, margin: "6px 0 4px" };
const keyRow: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderTop: "1px solid var(--border-soft, var(--border))", padding: "12px 2px" };
