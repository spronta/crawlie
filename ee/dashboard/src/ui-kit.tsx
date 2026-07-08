// Lightweight global UX primitives — toasts + a confirm modal — callable from
// anywhere without threading React context. Mount <Toaster/> and <ConfirmHost/>
// once at the app root.

import { Component, useEffect, useState, type ReactNode } from "react";

// --- Error boundary ----------------------------------------------------
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "var(--bg)", padding: 24 }}>
          <div style={{ textAlign: "center", maxWidth: 420 }}>
            <h1 style={{ fontSize: 22, color: "var(--heading, var(--text))" }}>Something went wrong</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>The page hit an unexpected error. Reloading usually fixes it.</p>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Avatar ------------------------------------------------------------
// Profile image when the account has one, otherwise initials on a hue derived
// from the email so each user gets a stable color.
export function Avatar({ name, email, image, size = 26 }: { name?: string | null; email: string; image?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const label = name?.trim() || email;
  if (image && !broken) {
    return <img className="cw-avatar" src={image} alt={label} referrerPolicy="no-referrer" onError={() => setBroken(true)} style={{ width: size, height: size }} />;
  }
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const words = label.split(/[\s@._-]+/).filter(Boolean);
  const initials = ((words[0]?.[0] ?? "?") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
  return (
    <span
      className="cw-avatar"
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: `linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 42) % 360} 58% 42%))` }}
    >
      {initials}
    </span>
  );
}

// --- Toasts ------------------------------------------------------------
type Kind = "info" | "success" | "error";
interface Toast {
  id: number;
  message: string;
  kind: Kind;
}
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
let counter = 1;
const emitToasts = () => toastListeners.forEach((l) => l());

export function toast(message: string, kind: Kind = "info"): void {
  const id = counter++;
  toasts = [...toasts, { id, message, kind }];
  emitToasts();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emitToasts();
  }, kind === "error" ? 6000 : 3500);
}

export function Toaster() {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    toastListeners.add(fn);
    return () => void toastListeners.delete(fn);
  }, []);
  return (
    <div style={{ position: "fixed", bottom: 20, right: 20, display: "flex", flexDirection: "column", gap: 8, zIndex: 1000, maxWidth: "min(92vw, 380px)" }}>
      {toasts.map((t) => (
        <div key={t.id} style={toastStyle(t.kind)}>{t.message}</div>
      ))}
    </div>
  );
}

function toastStyle(kind: Kind): React.CSSProperties {
  const accent = kind === "error" ? "var(--red, #ff6166)" : kind === "success" ? "var(--green, #3ddc91)" : "var(--blue, #0055ee)";
  return {
    background: "var(--panel, var(--bg))",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${accent}`,
    borderRadius: 10,
    padding: "11px 14px",
    fontSize: 13.5,
    boxShadow: "0 10px 30px -10px rgba(0,0,0,.4)",
    animation: "crawlie-toast-in .18s ease",
  };
}

// --- Confirm modal -----------------------------------------------------
interface ConfirmState {
  message: string;
  detail?: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (v: boolean) => void;
}
let confirmState: ConfirmState | null = null;
const confirmListeners = new Set<() => void>();
const emitConfirm = () => confirmListeners.forEach((l) => l());

export function confirmDialog(message: string, opts?: { detail?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState = { message, detail: opts?.detail, confirmLabel: opts?.confirmLabel ?? "Confirm", danger: opts?.danger ?? false, resolve };
    emitConfirm();
  });
}

export function ConfirmHost() {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    confirmListeners.add(fn);
    return () => void confirmListeners.delete(fn);
  }, []);
  const s = confirmState;
  if (!s) return null;
  const close = (v: boolean) => { confirmState = null; emitConfirm(); s.resolve(v); };
  return (
    <div style={overlay} onClick={() => close(false)}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--heading, var(--text))" }}>{s.message}</div>
        {s.detail && <div style={{ fontSize: 13.5, color: "var(--text-secondary)", marginTop: 8 }}>{s.detail}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <button className="btn" onClick={() => close(false)}>Cancel</button>
          <button className="btn btn-primary" style={s.danger ? { background: "var(--red, #ff6166)", borderColor: "var(--red, #ff6166)" } : undefined} onClick={() => close(true)}>{s.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", backdropFilter: "blur(2px)", display: "grid", placeItems: "center", zIndex: 1001, padding: 20 };
const modal: React.CSSProperties = { width: "100%", maxWidth: 400, background: "var(--panel, var(--bg))", border: "1px solid var(--border)", borderRadius: 14, padding: 22, boxShadow: "0 24px 60px -20px rgba(0,0,0,.6)" };
