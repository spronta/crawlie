// In-app sign-in — auth lives on crawlie.app itself (first-party). Renders when
// there's no session; on success the caller re-checks the session and swaps in
// the dashboard. GitHub OAuth + email one-time code, same endpoints as the CLI.

import { useEffect, useRef, useState } from "react";
import { Logo } from "@ui/components/ui";
import { sendOtp, signInGitHub, verifyOtp } from "./auth";

const GH = (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

type Msg = { text: string; kind: "ok" | "err" } | null;

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<"start" | "code">("start");
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [cooldown, setCooldown] = useState(0);
  const cells = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function github() {
    setBusy(true);
    setMsg({ text: "Redirecting to GitHub…", kind: "ok" });
    try {
      await signInGitHub();
    } catch (e) {
      setMsg({ text: String((e as Error).message), kind: "err" });
      setBusy(false);
    }
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email) return;
    setBusy(true);
    setMsg(null);
    try {
      await sendOtp(email);
      setStep("code");
      setCooldown(30);
      setMsg({ text: `Code sent to ${email}.`, kind: "ok" });
      setTimeout(() => cells.current[0]?.focus(), 0);
    } catch {
      setMsg({ text: "Could not send a code. Try GitHub instead.", kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  async function verify(code: string) {
    if (busy) return;
    setBusy(true);
    setMsg({ text: "Verifying…", kind: "ok" });
    try {
      await verifyOtp(email, code);
      onSignedIn();
    } catch {
      setMsg({ text: "That code did not work. Check and retry.", kind: "err" });
      setDigits(["", "", "", "", "", ""]);
      cells.current[0]?.focus();
      setBusy(false);
    }
  }

  function setDigit(i: number, v: string) {
    const d = v.replace(/[^0-9]/g, "").slice(-1);
    const next = [...digits];
    next[i] = d;
    setDigits(next);
    if (d && i < 5) cells.current[i + 1]?.focus();
    const joined = next.join("");
    if (joined.length === 6) verify(joined);
  }

  function onPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const d = e.clipboardData.getData("text").replace(/[^0-9]/g, "").slice(0, 6).split("");
    if (!d.length) return;
    const next = ["", "", "", "", "", ""].map((_, i) => d[i] ?? "");
    setDigits(next);
    cells.current[Math.min(d.length, 5)]?.focus();
    if (d.length === 6) verify(next.join(""));
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
            <Logo />
          </div>
          <h1 style={h1}>{step === "start" ? "Sign in to Crawlie Cloud" : "Check your email"}</h1>
          <p style={sub}>
            {step === "start"
              ? "One account for hosted crawls, the CLI, MCP and desktop app."
              : `Enter the 6-digit code sent to ${email}.`}
          </p>
        </div>

        {step === "start" ? (
          <>
            <button style={btnPrimary} onClick={github} disabled={busy}>
              {GH} Continue with GitHub
            </button>
            <div style={sep}>
              <span style={sepLine} /> or <span style={sepLine} />
            </div>
            <form onSubmit={send}>
              <input
                style={input}
                type="email"
                placeholder="you@company.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button style={{ ...btn, marginTop: 10 }} type="submit" disabled={busy}>
                Email me a sign-in code
              </button>
            </form>
          </>
        ) : (
          <>
            <div style={otpRow} onPaste={onPaste}>
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => (cells.current[i] = el)}
                  style={otpCell}
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  aria-label={`Digit ${i + 1}`}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !digits[i] && i > 0) cells.current[i - 1]?.focus();
                  }}
                />
              ))}
            </div>
            <div style={resendRow}>
              <button style={link} type="button" onClick={() => { setStep("start"); setDigits(["", "", "", "", "", ""]); setMsg(null); }}>
                Use a different email
              </button>
              <button style={link} type="button" disabled={cooldown > 0 || busy} onClick={() => send()}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          </>
        )}

        {msg && <div style={{ ...message, color: msg.kind === "ok" ? "var(--green, #3ddc91)" : "var(--red-text, #ff6166)" }}>{msg.text}</div>}

        <p style={consent}>
          By continuing you agree to the{" "}
          <a style={a} href="https://crawlie.dev/legal/terms" target="_blank" rel="noreferrer">Terms</a> &amp;{" "}
          <a style={a} href="https://crawlie.dev/legal/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = { minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "var(--bg)" };
const card: React.CSSProperties = { width: "100%", maxWidth: 392, background: "var(--panel, var(--bg))", border: "1px solid var(--border)", borderRadius: 16, padding: "34px 30px 24px" };
const h1: React.CSSProperties = { fontSize: 21, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 6px", color: "var(--heading, var(--text))" };
const sub: React.CSSProperties = { color: "var(--text-secondary, var(--muted))", margin: "0 auto", maxWidth: "31ch", fontSize: 14.5 };
const btn: React.CSSProperties = { width: "100%", height: 47, borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2, transparent)", color: "var(--text)", fontSize: 14.5, fontWeight: 550, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 9 };
const btnPrimary: React.CSSProperties = { ...btn, background: "var(--blue, #0055ee)", borderColor: "var(--blue, #0055ee)", color: "#fff", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.16)" };
const sep: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, color: "var(--muted-2, var(--muted))", fontSize: 11, textTransform: "uppercase", letterSpacing: ".14em", margin: "18px 2px" };
const sepLine: React.CSSProperties = { flex: 1, height: 1, background: "var(--border)" };
const input: React.CSSProperties = { width: "100%", height: 47, padding: "0 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-soft, var(--bg))", color: "var(--text)", fontSize: 14.5 };
const otpRow: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 8 };
const otpCell: React.CSSProperties = { width: "100%", height: 52, textAlign: "center", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-soft, var(--bg))", color: "var(--text)", fontFamily: "var(--font-mono, monospace)", fontSize: 21, fontWeight: 600 };
const resendRow: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, marginTop: 14 };
const link: React.CSSProperties = { background: "none", border: 0, color: "var(--link, #3b9eff)", fontSize: 13, cursor: "pointer", padding: 0 };
const message: React.CSSProperties = { marginTop: 14, fontSize: 13.5, textAlign: "center", minHeight: 18 };
const consent: React.CSSProperties = { margin: "18px auto 0", maxWidth: "32ch", fontSize: 11.5, lineHeight: 1.55, color: "var(--muted-2, var(--muted))", textAlign: "center" };
const a: React.CSSProperties = { color: "var(--link, #3b9eff)" };
