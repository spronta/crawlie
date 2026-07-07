// Sidebar account control: sign in to Crawlie Cloud (device flow) and show the
// signed-in identity. Shares the token file with the CLI and MCP server, so a
// sign-in here is a sign-in everywhere.

import { useEffect, useRef, useState } from "react";
import { IconUser, IconExternal, Spinner } from "./ui";
import { openExternal } from "@platform/api";
import {
  loadIdentity,
  login,
  logout,
  type DevicePrompt,
  type Identity,
  type LoginController,
} from "@platform/auth";

type Mode =
  | { name: "signedOut" }
  | { name: "pending"; prompt: DevicePrompt | null }
  | { name: "signedIn"; id: Identity };

export function AccountControl() {
  const [mode, setMode] = useState<Mode>({ name: "signedOut" });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<LoginController | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadIdentity().then((id) => id && setMode({ name: "signedIn", id }));
  }, []);

  // Close the popover on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function startLogin() {
    setError(null);
    setMode({ name: "pending", prompt: null });
    setOpen(true);
    const { promise, controller } = login((prompt) =>
      setMode({ name: "pending", prompt }),
    );
    ctrl.current = controller;
    promise
      .then((id) => {
        setMode({ name: "signedIn", id });
        setOpen(false);
      })
      .catch((e) => {
        if (String(e?.message) !== "cancelled") setError(String(e?.message ?? e));
        setMode({ name: "signedOut" });
      });
  }

  function cancelLogin() {
    ctrl.current?.cancel();
    setMode({ name: "signedOut" });
    setOpen(false);
  }

  async function signOut() {
    await logout();
    setMode({ name: "signedOut" });
    setOpen(false);
  }

  const label =
    mode.name === "signedIn"
      ? mode.id.email ?? "Signed in"
      : mode.name === "pending"
        ? "Signing in…"
        : "Sign in";

  return (
    <div className="account" ref={root} style={{ position: "relative" }}>
      <button
        className="nav-item"
        onClick={() => (mode.name === "signedOut" ? startLogin() : setOpen((o) => !o))}
        title={mode.name === "signedIn" ? mode.id.email : "Sign in to Crawlie Cloud"}
      >
        <IconUser size={16} />{" "}
        <span className="nav-label" style={ellipsis}>
          {label}
        </span>
      </button>

      {open && (
        <div style={popover} role="dialog">
          {mode.name === "pending" && (
            <div>
              <div style={popTitle}>Sign in to Crawlie Cloud</div>
              {mode.prompt ? (
                <>
                  <div style={popSub}>Enter this code in your browser:</div>
                  <div style={codeBox}>{mode.prompt.userCode}</div>
                  <button
                    className="linklike"
                    style={linkBtn}
                    onClick={() => openExternal(mode.prompt!.verificationUri)}
                  >
                    <IconExternal size={13} /> Reopen browser
                  </button>
                  <div style={{ ...popSub, marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
                    <Spinner /> Waiting for approval…
                  </div>
                </>
              ) : (
                <div style={{ ...popSub, display: "flex", gap: 6, alignItems: "center" }}>
                  <Spinner /> Starting…
                </div>
              )}
              <button style={ghostBtn} onClick={cancelLogin}>
                Cancel
              </button>
            </div>
          )}

          {mode.name === "signedIn" && (
            <div>
              <div style={popSub}>Signed in as</div>
              <div style={{ ...popTitle, wordBreak: "break-all" }}>{mode.id.email ?? "your account"}</div>
              <button style={ghostBtn} onClick={signOut}>
                Sign out
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={errBox} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

const ellipsis: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const popover: React.CSSProperties = {
  position: "absolute",
  bottom: "calc(100% + 8px)",
  left: 0,
  width: 232,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md, 10px)",
  boxShadow: "var(--shadow-pop, 0 8px 30px rgba(0,0,0,.18))",
  padding: 14,
  zIndex: 40,
};

const popTitle: React.CSSProperties = { fontWeight: 600, fontSize: 14, color: "var(--text)" };
const popSub: React.CSSProperties = { fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 };

const codeBox: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontWeight: 700,
  fontSize: 20,
  letterSpacing: 3,
  textAlign: "center",
  padding: "10px 0",
  border: "1px dashed var(--border-strong, var(--border))",
  borderRadius: 8,
  color: "var(--text)",
  margin: "4px 0 8px",
};

const linkBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  background: "none",
  border: "none",
  color: "var(--blue)",
  fontSize: 12,
  cursor: "pointer",
  padding: 0,
};

const ghostBtn: React.CSSProperties = {
  marginTop: 12,
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-subtle, transparent)",
  color: "var(--text)",
  fontSize: 13,
  cursor: "pointer",
};

const errBox: React.CSSProperties = {
  position: "absolute",
  bottom: "calc(100% + 8px)",
  left: 0,
  width: 232,
  background: "var(--red-bg, #fee)",
  color: "var(--red-text, #900)",
  border: "1px solid var(--red-border, #f99)",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
  zIndex: 40,
};
