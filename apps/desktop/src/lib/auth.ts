// Crawlie Cloud sign-in for the desktop app.
//
// Runs the OAuth 2.0 device flow in the webview (fetch + open the system
// browser), then persists the token to the SAME `~/.crawlie/auth.json` the CLI
// and MCP server use — so one sign-in covers every surface. In browser preview
// (`pnpm dev`, no Tauri) it falls back to localStorage so the UI stays usable.

import { isTauri, openExternal } from "./api";

const DEFAULT_CLOUD = "https://api.crawlie.dev";
const CLIENT_ID = "crawlie-desktop";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const LS_KEY = "crawlie.auth";

export interface Identity {
  email?: string;
  endpoint?: string;
}

/** Auth service base URL (override for local dev via localStorage). */
export function cloudUrl(): string {
  try {
    return localStorage.getItem("crawlie.cloudUrl") || DEFAULT_CLOUD;
  } catch {
    return DEFAULT_CLOUD;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function persist(endpoint: string, token: string, id: Identity): Promise<void> {
  if (isTauri()) {
    await invoke("auth_save", {
      token,
      endpoint,
      email: id.email ?? null,
      name: null,
    });
  } else {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ access_token: token, endpoint, user: { email: id.email } }),
    );
  }
}

/** The signed-in identity, or null. */
export async function loadIdentity(): Promise<Identity | null> {
  try {
    if (isTauri()) {
      const v = await invoke<{ access_token?: string; endpoint?: string; user?: { email?: string } } | null>(
        "auth_load",
      );
      if (!v || !v.access_token) return null;
      return { email: v.user?.email, endpoint: v.endpoint };
    }
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v?.access_token ? { email: v.user?.email, endpoint: v.endpoint } : null;
  } catch {
    return null;
  }
}

async function fetchIdentity(base: string, token: string): Promise<Identity> {
  try {
    const r = await fetch(`${base}/api/auth/get-session`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const v = await r.json();
    return { email: v?.user?.email, endpoint: base };
  } catch {
    return { endpoint: base };
  }
}

export interface DevicePrompt {
  userCode: string;
  verificationUri: string;
}

/** A pending sign-in that can be cancelled by the UI. */
export interface LoginController {
  cancel(): void;
}

/**
 * Start the device flow. `onPrompt` is called with the code to show the user;
 * resolves with the identity once approved, rejects on cancel/expiry/error.
 */
export function login(
  onPrompt: (p: DevicePrompt) => void,
): { promise: Promise<Identity>; controller: LoginController } {
  let cancelled = false;
  const controller: LoginController = { cancel: () => (cancelled = true) };

  const promise = (async (): Promise<Identity> => {
    const base = cloudUrl();
    const res = await fetch(`${base}/api/auth/device/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID }),
    });
    if (!res.ok) throw new Error("Could not start sign-in. Try again.");
    const c = await res.json();
    const verifyUri: string = c.verification_uri_complete || c.verification_uri;
    onPrompt({ userCode: c.user_code, verificationUri: verifyUri });
    await openExternal(verifyUri);

    let interval = Math.max(1, Number(c.interval) || 5);
    for (;;) {
      if (cancelled) throw new Error("cancelled");
      await sleep(interval * 1000);
      if (cancelled) throw new Error("cancelled");

      let t: Response;
      try {
        t = await fetch(`${base}/api/auth/device/token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            grant_type: DEVICE_GRANT,
            device_code: c.device_code,
            client_id: CLIENT_ID,
          }),
        });
      } catch {
        continue; // transient network blip — keep polling
      }

      if (t.ok) {
        const tok = await t.json();
        const id = await fetchIdentity(base, tok.access_token);
        await persist(base, tok.access_token, id);
        return id;
      }
      const err = await t.json().catch(() => ({}));
      switch (err.error) {
        case "authorization_pending":
          continue;
        case "slow_down":
          interval += 5;
          continue;
        case "access_denied":
          throw new Error("Sign-in was denied.");
        case "expired_token":
        case undefined:
          throw new Error("The code expired. Please try again.");
        default:
          throw new Error(`Sign-in failed: ${err.error}`);
      }
    }
  })();

  return { promise, controller };
}

/** Sign out: revoke server-side (best-effort) and clear the shared token. */
export async function logout(): Promise<void> {
  const base = cloudUrl();
  const id = await loadIdentity();
  if (id) {
    try {
      const token = isTauri()
        ? (await invoke<{ access_token?: string }>("auth_load"))?.access_token
        : JSON.parse(localStorage.getItem(LS_KEY) || "{}").access_token;
      if (token) {
        await fetch(`${base}/api/auth/sign-out`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
      }
    } catch {
      /* ignore — we still clear locally */
    }
  }
  if (isTauri()) await invoke("auth_clear");
  else localStorage.removeItem(LS_KEY);
}
