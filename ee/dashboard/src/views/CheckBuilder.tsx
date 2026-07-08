// Visual builder for custom audit checks (Pro): four dropdowns and two text
// fields become a `check_rule(...)` in the team's pack — no file editing.
// Includes a template gallery and a live "test against your last crawl"
// preview so a rule never ships misconfigured.

import { useEffect, useMemo, useState } from "react";
import { SeverityBadge, Spinner } from "@ui/components/ui";
import { listReports } from "@platform/api";
import { previewPack, type PackPreview } from "../cloud";
import { toast } from "../ui-kit";

type Sev = "error" | "warning" | "notice";
type Mode = "require" | "forbid";
type PredKind =
  | "text-contains"
  | "title-contains"
  | "description-contains"
  | "h1-contains"
  | "url-contains"
  | "field-present"
  | "field-matches"
  | "schema"
  | "links-to"
  | "extraction"
  | "min-words"
  | "max-words";

export interface CheckDraft {
  title: string;
  scope: string; // "" = all pages
  mode: Mode;
  kind: PredKind;
  field: string; // for field-present / field-matches
  value: string; // needle / regex / schema type / url fragment / number
  severity: Sev;
  why: string;
  fix: string;
}

const EMPTY: CheckDraft = {
  title: "",
  scope: "",
  mode: "require",
  kind: "title-contains",
  field: "canonical",
  value: "",
  severity: "warning",
  why: "",
  fix: "",
};

const PRED_LABEL: Record<PredKind, string> = {
  "text-contains": "Page text contains",
  "title-contains": "Title contains",
  "description-contains": "Meta description contains",
  "h1-contains": "H1 contains",
  "url-contains": "URL contains",
  "field-present": "Field is present",
  "field-matches": "Field matches regex",
  schema: "Schema type declared",
  "links-to": "Page links to",
  extraction: "Extraction matched",
  "min-words": "Word count at least",
  "max-words": "Word count at most",
};

const PRESENT_FIELDS = ["canonical", "title", "description", "h1", "lang"];
const MATCH_FIELDS = ["title", "description", "h1", "text", "url", "canonical"];

/** Templates: the top agency asks, pre-filled and editable. */
export const CHECK_TEMPLATES: Array<{ label: string; hint: string; draft: CheckDraft }> = [
  {
    label: "Brand in titles",
    hint: "Every product page title carries the brand",
    draft: { ...EMPTY, title: "Title missing brand", scope: "/products/*", kind: "title-contains", value: "Acme", severity: "warning", why: "Brand terms in titles support branded SERPs and recognition.", fix: "Append the brand via the title template." },
  },
  {
    label: "No staging links",
    hint: "Production must never link to staging",
    draft: { ...EMPTY, title: "Links to staging", mode: "forbid", kind: "links-to", value: "staging.", severity: "error", why: "Staging links leak unfinished work and break for visitors.", fix: "Point links at production URLs before publishing." },
  },
  {
    label: "Product schema on PDPs",
    hint: "Product pages must declare Product JSON-LD",
    draft: { ...EMPTY, title: "Missing Product schema", scope: "/products/*", kind: "schema", value: "Product", severity: "warning", why: "Product rich results need Product structured data.", fix: "Emit Product JSON-LD from the product template." },
  },
  {
    label: "No competitor mentions",
    hint: "Body copy never names a competitor",
    draft: { ...EMPTY, title: "Competitor mentioned", mode: "forbid", kind: "text-contains", value: "CompetitorName", severity: "notice", why: "Naming competitors in copy gives them relevance on your pages.", fix: "Rewrite the section without naming the competitor." },
  },
  {
    label: "Minimum article length",
    hint: "Blog posts must exceed 500 words",
    draft: { ...EMPTY, title: "Article too short", scope: "/blog/*", kind: "min-words", value: "500", severity: "notice", why: "Short posts rarely rank or earn citations.", fix: "Expand the article past 500 words of substance." },
  },
  {
    label: "Canonical everywhere",
    hint: "Every page declares a canonical",
    draft: { ...EMPTY, title: "Canonical missing", kind: "field-present", field: "canonical", severity: "warning", why: "Client standard: explicit canonicals on every template.", fix: "Add a self-referencing canonical to the layout." },
  },
  {
    label: "No placeholder copy",
    hint: "TODO / lorem never reaches production",
    draft: { ...EMPTY, title: "Placeholder copy live", mode: "forbid", kind: "text-contains", value: "lorem ipsum", severity: "error", why: "Placeholder text signals an unfinished page to users and engines.", fix: "Replace the placeholder with final copy." },
  },
  {
    label: "Phone number on contact",
    hint: "Contact pages show the phone number",
    draft: { ...EMPTY, title: "Contact page missing phone", scope: "/contact*", kind: "text-contains", value: "+44", severity: "warning", why: "The phone number is the page's primary conversion.", fix: "Add the standard phone block to the contact template." },
  },
];

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "custom-check";

/** Compile a draft into `.crawlie` source. */
export function draftToSource(d: CheckDraft): string {
  const pred = (() => {
    switch (d.kind) {
      case "text-contains": return `field("text", contains = "${esc(d.value)}")`;
      case "title-contains": return `field("title", contains = "${esc(d.value)}")`;
      case "description-contains": return `field("description", contains = "${esc(d.value)}")`;
      case "h1-contains": return `field("h1", contains = "${esc(d.value)}")`;
      case "url-contains": return `field("url", contains = "${esc(d.value)}")`;
      case "field-present": return `field("${esc(d.field)}")`;
      case "field-matches": return `field("${esc(d.field)}", matches = "${esc(d.value)}")`;
      case "schema": return `schema("${esc(d.value)}")`;
      case "links-to": return `links_to("${esc(d.value)}")`;
      case "extraction": return `extraction("${esc(d.value)}")`;
      case "min-words": return `field("word_count", min = ${Number(d.value) || 0})`;
      case "max-words": return `field("word_count", max = ${Number(d.value) || 0})`;
    }
  })();
  const lines = [
    `check_rule("${slug(d.title)}",`,
    `    title    = "${esc(d.title)}",`,
    `    severity = "${d.severity}",`,
  ];
  if (d.scope.trim()) lines.push(`    on       = "${esc(d.scope.trim())}",`);
  lines.push(`    ${(d.mode === "forbid" ? "forbid" : "require").padEnd(9)}= ${pred},`);
  if (d.why.trim()) lines.push(`    why      = "${esc(d.why.trim())}",`);
  if (d.fix.trim()) lines.push(`    fix      = "${esc(d.fix.trim())}",`);
  lines.push(")");
  return lines.join("\n");
}

const needsValue = (k: PredKind) => k !== "field-present";

export function CheckBuilder({ onSave, onCancel }: { onSave: (source: string) => Promise<void>; onCancel: () => void }) {
  const [d, setD] = useState<CheckDraft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [testing, setTesting] = useState(false);
  const [lastReport, setLastReport] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    listReports().then((rs) => rs[0] && setLastReport({ id: rs[0].id, url: rs[0].url })).catch(() => {});
  }, []);

  const source = useMemo(() => draftToSource(d), [d]);
  const set = (patch: Partial<CheckDraft>) => { setD((cur) => ({ ...cur, ...patch })); setPreview(null); };
  const valid = d.title.trim().length > 0 && (!needsValue(d.kind) || d.value.trim().length > 0);

  async function test() {
    setTesting(true);
    try {
      setPreview(await previewPack(source, lastReport?.id));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await onSave(source);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* Template gallery */}
      <div>
        <div style={label}>Start from a template</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
          {CHECK_TEMPLATES.map((t) => (
            <button key={t.label} style={tpl} onClick={() => set({ ...t.draft })} title={t.hint}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{t.label}</span>
              <span style={{ color: "var(--text-secondary)", fontSize: 11.5, lineHeight: 1.35 }}>{t.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* The rule sentence */}
      <div style={panel}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={rowStyle}>
            <span style={inline}>On</span>
            <select style={sel} value={d.scope === "" ? "all" : "scoped"} onChange={(e) => set({ scope: e.target.value === "all" ? "" : d.scope || "/blog/*" })}>
              <option value="all">every page</option>
              <option value="scoped">pages matching…</option>
            </select>
            {d.scope !== "" && (
              <input style={{ ...inp, flex: "1 1 140px", fontFamily: "var(--font-mono, monospace)" }} placeholder="/products/*" value={d.scope} onChange={(e) => set({ scope: e.target.value })} />
            )}
          </div>

          <div style={rowStyle}>
            <select style={sel} value={d.mode} onChange={(e) => set({ mode: e.target.value as Mode })}>
              <option value="require">require that</option>
              <option value="forbid">flag when</option>
            </select>
            <select style={{ ...sel, flex: "1 1 180px" }} value={d.kind} onChange={(e) => set({ kind: e.target.value as PredKind })}>
              {(Object.keys(PRED_LABEL) as PredKind[]).map((k) => (
                <option key={k} value={k}>{PRED_LABEL[k]}</option>
              ))}
            </select>
            {(d.kind === "field-present" || d.kind === "field-matches") && (
              <select style={sel} value={d.field} onChange={(e) => set({ field: e.target.value })}>
                {(d.kind === "field-present" ? PRESENT_FIELDS : MATCH_FIELDS).map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            )}
            {needsValue(d.kind) && (
              <input
                style={{ ...inp, flex: "2 1 160px" }}
                placeholder={d.kind === "schema" ? "Product" : d.kind === "links-to" ? "staging.example.com" : d.kind.endsWith("words") ? "500" : d.kind === "field-matches" ? "regex" : "text…"}
                value={d.value}
                onChange={(e) => set({ value: e.target.value })}
              />
            )}
          </div>

          <div style={rowStyle}>
            <span style={inline}>Report as</span>
            <div style={{ display: "inline-flex", gap: 6 }}>
              {(["error", "warning", "notice"] as Sev[]).map((s) => (
                <button key={s} onClick={() => set({ severity: s })} style={{ ...sevBtn, ...(d.severity === s ? sevOn : {}) }}>
                  <SeverityBadge severity={s} />
                </button>
              ))}
            </div>
            <input style={{ ...inp, flex: "2 1 200px" }} placeholder='Issue title, e.g. "Title missing brand"' value={d.title} onChange={(e) => set({ title: e.target.value })} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <textarea style={ta} placeholder="Why it matters (shown in the report)" value={d.why} onChange={(e) => set({ why: e.target.value })} />
            <textarea style={ta} placeholder="How to fix (shown in the report)" value={d.fix} onChange={(e) => set({ fix: e.target.value })} />
          </div>
        </div>
      </div>

      {/* Generated source */}
      <div>
        <div style={label}>Generated rule</div>
        <pre style={srcBox}>{source}</pre>
      </div>

      {/* Test + save */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" onClick={test} disabled={testing || !valid} title={lastReport ? `Runs against ${lastReport.url}` : "Run a crawl first to test"}>
          {testing ? <Spinner /> : lastReport ? `Test against ${hostOf(lastReport.url)}` : "Test rule"}
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !valid}>{busy ? <Spinner /> : "Add check"}</button>
        <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
      </div>

      {preview && (
        <div style={panel}>
          {!preview.ok ? (
            <div style={{ color: "var(--red-text, #ff6166)", fontSize: 13 }}>
              Parse error (line {preview.error?.line}): {preview.error?.message}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: (preview.findings?.length ?? 0) > 0 ? 10 : 0 }}>
                {(preview.findings?.length ?? 0) === 0
                  ? `No pages flagged across ${preview.pagesTested} tested — the standard currently holds.`
                  : `${preview.findings?.length} page(s) would be flagged across ${preview.pagesTested} tested:`}
              </div>
              <div style={{ display: "grid", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                {(preview.findings ?? []).slice(0, 30).map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
                    <SeverityBadge severity={f.severity} />
                    <span style={{ fontFamily: "var(--font-mono, monospace)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-secondary)" }}>{f.url}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

const label: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--text-secondary)", marginBottom: 8 };
const panel: React.CSSProperties = { background: "var(--panel, var(--bg))", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const tpl: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, textAlign: "left", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel, var(--bg))", color: "var(--text)", cursor: "pointer" };
const rowStyle: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const inline: React.CSSProperties = { fontSize: 13, color: "var(--text-secondary)", flex: "0 0 auto" };
const inp: React.CSSProperties = { height: 38, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-soft, var(--bg))", color: "var(--text)", fontSize: 13.5, minWidth: 0 };
const sel: React.CSSProperties = { ...inp, cursor: "pointer" };
const ta: React.CSSProperties = { ...inp, height: 64, padding: 10, resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 };
const sevBtn: React.CSSProperties = { background: "none", border: "1px solid transparent", borderRadius: 8, padding: "4px 6px", cursor: "pointer", opacity: 0.55 };
const sevOn: React.CSSProperties = { opacity: 1, border: "1px solid var(--border)", background: "var(--bg-soft, var(--bg))" };
const srcBox: React.CSSProperties = { margin: 0, padding: 14, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-soft, var(--bg))", fontFamily: "var(--font-mono, monospace)", fontSize: 12.5, lineHeight: 1.55, overflowX: "auto" };
