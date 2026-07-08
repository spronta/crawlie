// Custom extraction (Screaming-Frog-style): configure CSS/regex extractors on a
// project and view the pulled values per page. Engine-native — the config flows
// straight through the crawl; the report JSON carries per-page `extractions`.

import { useState } from "react";
import { IconTrash, Spinner } from "@ui/components/ui";
import type { Extractor } from "./cloud";

export function ExtractorEditor({
  value,
  onSave,
}: {
  value: Extractor[];
  onSave: (rows: Extractor[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<Extractor[]>(value.length ? value : [{ name: "", css: "" }]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  function set(i: number, patch: Partial<Extractor>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  const add = () => setRows((r) => [...r, { name: "", css: "" }]);
  const remove = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));

  async function save() {
    setBusy(true);
    try {
      const clean = rows
        .filter((r) => r.name.trim() && (r.css?.trim() || r.regex?.trim()))
        .map((r) => ({ name: r.name.trim(), css: r.css?.trim() || undefined, attr: r.attr?.trim() || undefined, regex: r.regex?.trim() || undefined }));
      await onSave(clean);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p style={{ color: "var(--text-secondary)", fontSize: 12.5, margin: "0 0 12px" }}>
        Pull any data off every crawled page with a CSS selector (e.g. <code style={code}>.price</code>) or regex.
        Runs on every crawl, including scheduled ones.
      </p>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <input style={{ ...inp, width: 130 }} placeholder="name (price)" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
          <input style={{ ...inp, flex: "1 1 160px" }} placeholder="CSS selector (.price)" value={r.css ?? ""} onChange={(e) => set(i, { css: e.target.value })} />
          <input style={{ ...inp, width: 110 }} placeholder="attr (opt.)" value={r.attr ?? ""} onChange={(e) => set(i, { attr: e.target.value })} />
          <button className="btn btn-sm" onClick={() => remove(i)} title="Remove"><IconTrash size={13} /></button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button className="btn btn-sm" onClick={add}>+ Add extractor</button>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
          {busy ? <Spinner /> : saved ? "Saved!" : "Save extraction"}
        </button>
      </div>
    </div>
  );
}

type PageX = { url: string; extractions?: { name: string; values: string[] }[] };

export function ExtractionTable({ pages }: { pages: PageX[] }) {
  const withData = pages.filter((p) => p.extractions && p.extractions.length);
  if (!withData.length) return null;
  const cols = Array.from(new Set(withData.flatMap((p) => p.extractions!.map((e) => e.name))));
  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-secondary)", marginBottom: 10 }}>
        Extracted data
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>URL</th>
              {cols.map((c) => <th key={c} style={th}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {withData.map((p) => (
              <tr key={p.url}>
                <td style={{ ...td, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--link, #3b9eff)" }}>{p.url}</td>
                {cols.map((c) => {
                  const v = p.extractions!.find((e) => e.name === c)?.values ?? [];
                  return <td key={c} style={td}>{v.join(", ")}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { height: 36, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-soft, var(--bg))", color: "var(--text)", fontSize: 13 };
const code: React.CSSProperties = { fontFamily: "var(--font-mono, monospace)", fontSize: 11.5, background: "var(--panel-2, transparent)", padding: "1px 4px", borderRadius: 4 };
const th: React.CSSProperties = { textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--panel-2, transparent)", fontWeight: 600, whiteSpace: "nowrap", position: "sticky", top: 0 };
const td: React.CSSProperties = { padding: "8px 12px", borderBottom: "1px solid var(--border-soft, var(--border))", verticalAlign: "top" };
