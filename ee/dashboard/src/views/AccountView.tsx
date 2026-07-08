import { useEffect, useState } from "react";
import { IconBack, IconTrash, Spinner } from "@ui/components/ui";
import {
  listKeys, createKey, revokeKey, type ApiKeyMeta,
  getTeamInfo, listTeams, renameTeam, inviteMember, removeMember, setActiveTeam, activeTeam,
  checkout, billingPortal, deleteAccount, type TeamInfo, type Plan,
} from "../cloud";
import { updateName, signOutEverywhere } from "../auth";
import { toast, confirmDialog } from "../ui-kit";
import { relTime } from "../format";

export function AccountView({ user, onBack }: { user: { email: string; name?: string | null }; onBack: () => void }) {
  const email = user.email;
  const [info, setInfo] = useState<TeamInfo | null>(null);
  const [teams, setTeams] = useState<Array<{ id: string; name: string; role: string; plan: Plan }>>([]);
  const load = () => {
    getTeamInfo().then(setInfo).catch(() => setInfo(null));
    listTeams().then(setTeams).catch(() => {});
  };
  useEffect(load, []);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 28px 60px", width: "100%" }}>
      <button className="btn btn-sm" onClick={onBack} style={{ marginBottom: 18 }}>
        <IconBack size={15} /> Back
      </button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>Account</h1>
          <p style={{ color: "var(--text-secondary)", margin: 0 }}>{email}</p>
        </div>
        {teams.length > 1 && (
          <select
            style={select}
            value={activeTeam() ?? info?.team.id ?? ""}
            onChange={(e) => { setActiveTeam(e.target.value); location.reload(); }}
          >
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      <ProfileSection user={user} />
      {!info ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner /></div>
      ) : (
        <>
          <PlanSection info={info} />
          <TeamSection info={info} onChange={load} />
        </>
      )}
      <KeysSection />
      <DangerZone />
    </div>
  );
}

function DangerZone() {
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ ...panel, borderColor: "color-mix(in srgb, var(--red, #ff6166) 40%, var(--border))" }}>
      <div style={{ ...panelTitle, color: "var(--red-text, #ff6166)" }}>Danger zone</div>
      <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: "0 0 12px" }}>
        Permanently delete your account and all data in workspaces you solely own. This can't be undone.
      </p>
      <button
        className="btn btn-sm"
        style={{ borderColor: "var(--red, #ff6166)", color: "var(--red-text, #ff6166)" }}
        disabled={busy}
        onClick={async () => {
          if (!(await confirmDialog("Delete your account?", { detail: "Your account, projects, reports and rule packs will be permanently deleted. This cannot be undone.", danger: true, confirmLabel: "Delete my account" }))) return;
          setBusy(true);
          try {
            await deleteAccount();
            window.location.href = "https://crawlie.dev/";
          } catch (e) {
            toast((e as Error).message, "error");
            setBusy(false);
          }
        }}
      >
        Delete account
      </button>
    </div>
  );
}

function ProfileSection({ user }: { user: { email: string; name?: string | null } }) {
  const [name, setName] = useState(user.name ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <div style={panel}>
      <div style={panelTitle}>Profile</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <input style={{ ...input, flex: "1 1 200px" }} placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-sm" disabled={busy || name === (user.name ?? "")} onClick={async () => { setBusy(true); const ok = await updateName(name.trim()); setBusy(false); toast(ok ? "Name updated" : "Could not update name", ok ? "success" : "error"); }}>Save</button>
      </div>
      <button className="btn btn-sm" onClick={async () => { if (await confirmDialog("Sign out of all devices?", { detail: "Every active session for your account will be signed out.", confirmLabel: "Sign out everywhere" })) signOutEverywhere(); }}>
        Sign out of all devices
      </button>
    </div>
  );
}

function PlanSection({ info }: { info: TeamInfo }) {
  const { plan, usage, team, plans, billingEnabled } = info;
  const isOwner = team.role === "owner";
  const [busy, setBusy] = useState<string | null>(null);
  const pct = Math.min(100, Math.round((usage.crawls / plan.crawlsPerMonth) * 100));

  async function upgrade(p: Plan) {
    setBusy(p);
    try {
      const { url } = await checkout(p);
      window.location.href = url;
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(null);
    }
  }
  async function manage() {
    try {
      const { url } = await billingPortal();
      window.location.href = url;
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const order: Plan[] = ["free", "pro", "business"];
  return (
    <div style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div style={panelTitle}>Plan &amp; usage</div>
        <div style={{ fontSize: 13 }}>
          Current: <b>{plan.label}</b>{plan.priceMonthly > 0 ? ` · $${plan.priceMonthly}/mo` : ""}
        </div>
      </div>

      <div style={{ margin: "6px 0 4px", fontSize: 13, color: "var(--text-secondary)" }}>
        Crawls this month: {usage.crawls.toLocaleString()} / {plan.crawlsPerMonth.toLocaleString()}
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "var(--panel-2, var(--border))", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: pct > 90 ? "var(--red, #ff6166)" : "var(--blue, #0055ee)" }} />
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 6 }}>
        {plan.projects.toLocaleString()} projects · {plan.seats} seat{plan.seats === 1 ? "" : "s"} · {plan.scheduling ? "scheduled crawls" : "no scheduling"}
      </div>

      {isOwner && (
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {order.filter((p) => plans[p].priceMonthly > plan.priceMonthly).map((p) => (
            <button key={p} className="btn btn-primary btn-sm" disabled={!!busy || !billingEnabled} onClick={() => upgrade(p)}>
              {busy === p ? <Spinner /> : `Upgrade to ${plans[p].label} · $${plans[p].priceMonthly}/mo`}
            </button>
          ))}
          {team.stripeCustomer && <button className="btn btn-sm" onClick={manage}>Manage billing</button>}
          {!billingEnabled && <span style={{ fontSize: 12, color: "var(--text-secondary)", alignSelf: "center" }}>Billing setup pending</span>}
        </div>
      )}
    </div>
  );
}

function TeamSection({ info, onChange }: { info: TeamInfo; onChange: () => void }) {
  const { team, members, plan } = info;
  const isAdmin = team.role !== "member";
  const [name, setName] = useState(team.name);
  const [inviteEmail, setInviteEmail] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div style={panel}>
      <div style={panelTitle}>Team</div>
      {isAdmin && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input style={{ ...input, flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-sm" disabled={name === team.name} onClick={() => renameTeam(name).then(onChange)}>Rename</button>
        </div>
      )}
      {members.map((m) => (
        <div key={m.userId} style={memberRow}>
          <div>
            <div style={{ fontSize: 14 }}>{m.email ?? m.userId}</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{m.role} · joined {relTime(m.joinedAt)}</div>
          </div>
          {isAdmin && m.role !== "owner" && (
            <button className="btn btn-sm" onClick={() => removeMember(m.userId).then(onChange)} title="Remove"><IconTrash size={13} /></button>
          )}
        </div>
      ))}
      {isAdmin && (
        <form
          style={{ display: "flex", gap: 8, marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!inviteEmail.trim()) return;
            setBusy(true);
            inviteMember(inviteEmail.trim())
              .then(() => { setInviteEmail(""); onChange(); toast("Invite sent", "success"); })
              .catch((err) => toast(err.message, "error"))
              .finally(() => setBusy(false));
          }}
        >
          <input style={{ ...input, flex: 1 }} type="email" placeholder={`Invite teammate (${members.length}/${plan.seats} seats)`} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>{busy ? <Spinner /> : "Invite"}</button>
        </form>
      )}
    </div>
  );
}

function KeysSection() {
  const [keys, setKeys] = useState<ApiKeyMeta[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const refresh = () => listKeys().then(setKeys).catch(() => setKeys([]));
  useEffect(() => { refresh(); }, []);

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
    <div style={panel}>
      <div style={panelTitle}>API keys</div>
      <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 0 }}>
        Authenticate the CLI, MCP or CI as this account: <code style={code}>Authorization: Bearer crw_…</code> against <code style={code}>crawlie.app/v1</code>.
      </p>
      {fresh && (
        <div style={freshBox}>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 6 }}>Copy your key now — you won't see it again.</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ ...code, flex: 1, padding: "8px 10px", wordBreak: "break-all" }}>{fresh}</code>
            <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(fresh)}>Copy</button>
            <button className="btn btn-sm" onClick={() => setFresh(null)}>Done</button>
          </div>
        </div>
      )}
      <form onSubmit={create} style={{ display: "flex", gap: 8, margin: "14px 0" }}>
        <input style={{ ...input, flex: 1 }} placeholder="Key name (e.g. CI)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>{busy ? <Spinner /> : "Create key"}</button>
      </form>
      {keys === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 20 }}><Spinner /></div>
      ) : keys.length === 0 ? (
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>No keys yet.</p>
      ) : (
        keys.map((k) => (
          <div key={k.id} style={memberRow}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{k.name}</div>
              <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>
                <code style={code}>{k.prefix}…</code> · created {relTime(k.createdAt)}{k.lastUsedAt ? ` · used ${relTime(k.lastUsedAt)}` : " · never used"}
              </div>
            </div>
            <button className="btn btn-sm" onClick={() => revokeKey(k.id).then(refresh)} title="Revoke"><IconTrash size={14} /></button>
          </div>
        ))
      )}
    </div>
  );
}

const panel: React.CSSProperties = { background: "var(--panel, var(--bg))", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginTop: 18 };
const panelTitle: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-secondary)", marginBottom: 12 };
const input: React.CSSProperties = { height: 40, padding: "0 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-soft, var(--bg))", color: "var(--text)", fontSize: 14 };
const select: React.CSSProperties = { height: 38, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-soft, var(--bg))", color: "var(--text)", cursor: "pointer", fontSize: 13.5 };
const memberRow: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderTop: "1px solid var(--border-soft, var(--border))", padding: "12px 2px" };
const code: React.CSSProperties = { fontFamily: "var(--font-mono, monospace)", fontSize: 12, background: "var(--panel-2, transparent)", padding: "1px 5px", borderRadius: 5, border: "1px solid var(--border-soft, var(--border))" };
const freshBox: React.CSSProperties = { background: "color-mix(in srgb, var(--green, #3ddc91) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--green, #3ddc91) 32%, transparent)", borderRadius: 10, padding: 12, margin: "6px 0 4px" };
