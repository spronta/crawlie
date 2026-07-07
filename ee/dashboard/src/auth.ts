// Web auth — first-party. The dashboard is served from crawlie.app and the auth
// API lives on the SAME origin (crawlie.app/api/auth/*), so the session cookie
// is first-party and everything is a plain same-origin fetch. VITE_AUTH_URL can
// override the base for local dev against the deployed Worker.

const AUTH = import.meta.env.VITE_AUTH_URL ?? "";

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
};

function api(path: string, body?: unknown) {
  return fetch(`${AUTH}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body ?? {}),
  });
}

/** Current signed-in user, or null if there's no valid session. */
export async function getSession(): Promise<SessionUser | null> {
  try {
    const res = await fetch(`${AUTH}/api/auth/get-session`, { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: SessionUser } | null;
    return data && data.user ? data.user : null;
  } catch {
    return null;
  }
}

/** Begin GitHub OAuth, returning to the app afterwards. */
export async function signInGitHub(): Promise<void> {
  const res = await api("/sign-in/social", {
    provider: "github",
    callbackURL: `${window.location.origin}/`,
  });
  const data = (await res.json()) as { url?: string };
  if (data.url) window.location.href = data.url;
  else throw new Error("Could not start GitHub sign-in.");
}

/** Email a one-time sign-in code. */
export async function sendOtp(email: string): Promise<void> {
  const res = await api("/email-otp/send-verification-otp", { email, type: "sign-in" });
  if (!res.ok) throw new Error("Could not send a code.");
}

/** Verify the emailed code; establishes the session cookie on success. */
export async function verifyOtp(email: string, otp: string): Promise<void> {
  const res = await api("/sign-in/email-otp", { email, otp });
  if (!res.ok) throw new Error("That code did not work.");
}

export async function signOut(): Promise<void> {
  try {
    await api("/sign-out");
  } catch {
    /* ignore */
  }
  window.location.reload();
}
