import { useEffect, useState } from "react";
import { IconSpark, IconTrash, Toggle, Spinner } from "@ui/components/ui";
import { listPacks, createPack, updatePack, deletePack, PACK_TEMPLATES, type RulePack } from "../cloud";

export function PacksView() {
  const [packs, setPacks] = useState<RulePack[] | null>(null);
  const [editing, setEditing] = useState<RulePack | "new" | null>(null);
  const refresh = () => listPacks().then(setPacks).catch(() => setPacks([]));
  useEffect(() => { refresh(); }, []);

  if (editing) return <Editor pack={editing === "new" ? null : editing} onDone={() => { setEditing(null); refresh(); }} />;

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "40px 28px", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <h1 style={{ fontSize: 26, margin: 0 }}>Rules</h1>
        <button className="btn btn-primary" onClick={() => setEditing("new")}><IconSpark size={15} /> New rule pack</button>
      </div>
      <p style={{ color: "var(--text-secondary)", marginTop: 0, marginBottom: 24, maxWidth: "60ch" }}>
        Marketing monitoring as code. Write deterministic <code style={code}>.crawlie</code> rules — brand voice, banned words,
        AI-slop, competitor mentions — and they run on every crawl, including scheduled ones.
      </p>

      {packs === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner /></div>
      ) : packs.length === 0 ? (
        <div style={empty}>
          <p style={{ color: "var(--text-secondary)", margin: "0 0 16px" }}>No rule packs yet.</p>
          <button className="btn btn-primary" onClick={() => setEditing("new")}>Create your first pack</button>
        </div>
      ) : (
        packs.map((p) => (
          <div key={p.id} style={card}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
              <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>{p.source.split("\n").filter((l) => l.includes("_rule(")).length} rules</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Toggle on={p.enabled} onChange={(v) => updatePack(p.id, { enabled: v }).then(refresh)} label="" />
              <button className="btn btn-sm" onClick={() => setEditing(p)}>Edit</button>
              <button className="btn btn-sm" onClick={() => { if (confirm(`Delete "${p.name}"?`)) deletePack(p.id).then(refresh); }}><IconTrash size={13} /></button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function Editor({ pack, onDone }: { pack: RulePack | null; onDone: () => void }) {
  const [name, setName] = useState(pack?.name ?? "");
  const [source, setSource] = useState(pack?.source ?? PACK_TEMPLATES[0].source);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      if (pack) await updatePack(pack.id, { name: name || pack.name, source });
      else await createPack(name || "New pack", source);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 28px 60px", width: "100%" }}>
      <button className="btn btn-sm" onClick={onDone} style={{ marginBottom: 18 }}>← Rules</button>
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <input style={{ ...input, flex: "1 1 220px" }} placeholder="Pack name" value={name} onChange={(e) => setName(e.target.value)} />
        {!pack && (
          <select
            style={select}
            onChange={(e) => {
              const t = PACK_TEMPLATES.find((x) => x.name === e.target.value);
              if (t) { setSource(t.source); if (!name) setName(t.label); }
            }}
            defaultValue=""
          >
            <option value="" disabled>Start from template…</option>
            {PACK_TEMPLATES.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
          </select>
        )}
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : "Save pack"}</button>
      </div>
      <textarea
        style={editor}
        spellCheck={false}
        value={source}
        onChange={(e) => setSource(e.target.value)}
      />
      <p style={{ color: "var(--text-secondary)", fontSize: 12.5, marginTop: 8 }}>
        Syntax: <code style={code}>phrase_rule("name", weight = 3, phrases = ["...", "..."])</code>,
        {" "}<code style={code}>regex_rule("name", weight = 2, pattern = "...")</code>. Higher score = more violations.
      </p>
    </div>
  );
}

const card: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "var(--panel, var(--bg))", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 10 };
const empty: React.CSSProperties = { textAlign: "center", padding: "60px 20px", border: "1px dashed var(--border)", borderRadius: 12 };
const input: React.CSSProperties = { height: 42, padding: "0 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-soft, var(--bg))", color: "var(--text)", fontSize: 14 };
const select: React.CSSProperties = { ...input, cursor: "pointer" };
const editor: React.CSSProperties = { width: "100%", minHeight: 340, padding: 14, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-soft, var(--bg))", color: "var(--text)", fontFamily: "var(--font-mono, monospace)", fontSize: 13, lineHeight: 1.55, resize: "vertical" };
const code: React.CSSProperties = { fontFamily: "var(--font-mono, monospace)", fontSize: 12, background: "var(--panel-2, transparent)", padding: "1px 5px", borderRadius: 5, border: "1px solid var(--border-soft, var(--border))" };
