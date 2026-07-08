// Lightweight global UX primitives — toasts + a confirm modal — callable from
// anywhere without threading React context. Mount <Toaster/> and <ConfirmHost/>
// once at the app root.

import { useEffect, useState } from "react";

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
