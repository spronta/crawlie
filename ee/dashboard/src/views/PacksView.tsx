import { useEffect, useState } from "react";
import { IconSpark, IconTrash, Toggle, Spinner } from "@ui/components/ui";
import {
  listPacks, createPack, updatePack, deletePack, getTeamInfo, checkout,
  PACK_TEMPLATES, type RulePack,
} from "../cloud";
import { toast, confirmDialog } from "../ui-kit";
import { CheckBuilder } from "./CheckBuilder";

/** Where builder-made checks live: one team pack, created on first save. */
const STANDARDS_PACK = "Site standards";

export function PacksView() {
  const [packs, setPacks] = useState<RulePack[] | null>(null);
  const [editing, setEditing] = useState<RulePack | "new" | null>(null);
  const [building, setBuilding] = useState(false);
  const [customRulesAllowed, setCustomRulesAllowed] = useState(true);
  const refresh = () => listPacks().then(setPacks).catch(() => setPacks([]));
  useEffect(() => {
    refresh();
    getTeamInfo().then((t) => setCustomRulesAllowed(!!(t.plan as { customRules?: boolean }).customRules)).catch(() => {});
  }, []);

  async function saveCheck(snippet: string) {
    try {
      const existing = (packs ?? []).find((p) => p.name === STANDARDS_PACK);
      if (existing) await updatePack(existing.id, { source: `${existing.source.trimEnd()}\n\n${snippet}\n` });
      else await createPack(STANDARDS_PACK, `# ${STANDARDS_PACK} — custom audit checks, built visually.\n# They run on every crawl and appear in reports like built-in rules.\n\n${snippet}\n`);
      toast("Check added — it runs on every crawl from now on", "success");
      setBuilding(false);
      refresh();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "plan") toast("Custom audit rules are a Pro feature", "error");
      else toast(err.message, "error");
      throw e;
    }
  }

  if (building) {
    return (
      <div className="view">
        <header className="view-bar">
          <div style={{ minWidth: 0 }}>
            <h1>New custom check</h1>
            <p className="sub">Runs on every crawl and shows up in reports with your severity and fix guidance.</p>
          </div>
          <button className="btn" onClick={() => setBuilding(false)} style={{ flex: "0 0 auto" }}>← Rules</button>
        </header>
        <div className="view-body">
          <div className="view-body-inner" style={{ maxWidth: 860 }}>
            {!customRulesAllowed && <UpsellBanner />}
            <CheckBuilder onSave={saveCheck} onCancel={() => setBuilding(false)} />
          </div>
        </div>
      </div>
    );
  }

  if (editing) return <Editor pack={editing === "new" ? null : editing} onDone={() => { setEditing(null); refresh(); }} />;

  return (
    <div className="view">
      <header className="view-bar">
        <div style={{ minWidth: 0 }}>
          <h1>Rules</h1>
          <p className="sub">Your standards as code — checks and content rules that run on every crawl.</p>
        </div>
        <div style={{ display: "flex", gap: "var(--sp-2)", flex: "0 0 auto" }}>
          <button className="btn" onClick={() => setEditing("new")}>New rule pack</button>
          <button className="btn btn-primary" onClick={() => setBuilding(true)}>
            <IconSpark size={15} /> New check
            {!customRulesAllowed && <span style={proPill}>PRO</span>}
          </button>
        </div>
      </header>
      <div className="view-body">
      <div className="view-body-inner" style={{ maxWidth: 820 }}>
      <p style={{ color: "var(--text-secondary)", marginTop: 0, marginBottom: 24, maxWidth: "62ch", font: "var(--copy-14)" }}>
        <b>Custom checks</b> audit every page ("product pages need Product schema", "never link to staging")
        and appear in reports like built-in rules. <b>Content rules</b> score copy — brand voice, banned words,
        AI slop. Both run on every crawl, including scheduled ones.
      </p>

      {packs === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><Spinner /></div>
      ) : packs.length === 0 ? (
        <div style={empty}>
          <p style={{ color: "var(--text-secondary)", margin: "0 0 16px" }}>No rules yet.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={() => setBuilding(true)}>Create your first check</button>
            <button className="btn" onClick={() => setEditing("new")}>Write a pack</button>
          </div>
        </div>
      ) : (
        packs.map((p) => {
          const checks = p.source.split("\n").filter((l) => l.trimStart().startsWith("check_rule(")).length;
          const content = p.source.split("\n").filter((l) => /^(phrase|regex|metric)_rule\(/.test(l.trimStart())).length;
          return (
            <div key={p.id} style={card}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>
                  {[checks > 0 && `${checks} check${checks === 1 ? "" : "s"}`, content > 0 && `${content} content rule${content === 1 ? "" : "s"}`]
                    .filter(Boolean)
                    .join(" · ") || "empty"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Toggle on={p.enabled} onChange={(v) => updatePack(p.id, { enabled: v }).then(refresh)} label="" />
                <button className="btn btn-sm" onClick={() => setEditing(p)}>Edit</button>
                <button className="btn btn-sm" onClick={async () => { if (await confirmDialog(`Delete "${p.name}"?`, { danger: true, confirmLabel: "Delete" })) { await deletePack(p.id); toast("Pack deleted", "success"); refresh(); } }}><IconTrash size={13} /></button>
              </div>
            </div>
          );
        })
      )}
      </div>
      </div>
    </div>
  );
}

function UpsellBanner() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 12, border: "1px solid var(--blue-border, var(--border))", background: "var(--blue-bg, var(--panel))", marginBottom: 18, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13.5 }}>
        Custom audit checks are a <b>Pro</b> feature. Build and test one now — upgrading takes a minute when
        you're ready to save it.
      </span>
      <button className="btn btn-sm btn-primary" style={{ marginLeft: "auto" }} onClick={async () => { const { url } = await checkout("pro"); window.location.href = url; }}>
        Upgrade to Pro
      </button>
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
      toast("Rule pack saved", "success");
      onDone();
    } catch (e) {
      const err = e as Error & { code?: string };
      toast(err.code === "plan" ? "Custom audit rules (check_rule) are a Pro feature" : err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="view">
      <header className="view-bar">
        <div style={{ minWidth: 0 }}>
          <h1>{pack ? "Edit rule pack" : "New rule pack"}</h1>
          <p className="sub">Write content and audit rules directly as <code style={code}>.crawlie</code> source.</p>
        </div>
        <button className="btn" onClick={onDone} style={{ flex: "0 0 auto" }}>← Rules</button>
      </header>
      <div className="view-body">
      <div className="view-body-inner" style={{ maxWidth: 820 }}>
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
        Content rules: <code style={code}>phrase_rule("name", weight = 3, phrases = ["..."])</code>,
        {" "}<code style={code}>regex_rule("name", weight = 2, pattern = "...")</code>.
        Custom checks (Pro): <code style={code}>check_rule("id", severity = "warning", on = "/blog/*", require = field("title", contains = "..."), fix = "...")</code>
        {" "}with predicates <code style={code}>field(...)</code>, <code style={code}>schema("Product")</code>,
        {" "}<code style={code}>links_to("host")</code>, <code style={code}>extraction("name")</code>.
      </p>
      </div>
      </div>
    </div>
  );
}

const proPill: React.CSSProperties = { marginLeft: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: ".06em", padding: "2px 5px", borderRadius: 5, background: "rgba(255,255,255,0.22)" };
const card: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "var(--panel, var(--bg))", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 10 };
const empty: React.CSSProperties = { textAlign: "center", padding: "60px 20px", border: "1px dashed var(--border)", borderRadius: 12 };
const input: React.CSSProperties = { height: 42, padding: "0 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-soft, var(--bg))", color: "var(--text)", fontSize: 14 };
const select: React.CSSProperties = { ...input, cursor: "pointer" };
const editor: React.CSSProperties = { width: "100%", minHeight: 340, padding: 14, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-soft, var(--bg))", color: "var(--text)", fontFamily: "var(--font-mono, monospace)", fontSize: 13, lineHeight: 1.55, resize: "vertical" };
const code: React.CSSProperties = { fontFamily: "var(--font-mono, monospace)", fontSize: 12, background: "var(--panel-2, transparent)", padding: "1px 5px", borderRadius: 5, border: "1px solid var(--border-soft, var(--border))" };
