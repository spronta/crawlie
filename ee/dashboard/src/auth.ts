// Web auth: read the Crawlie Cloud (Better Auth) session that the hosted
// sign-in at api.crawlie.app establishes. The dashboard and the auth Worker
// share the `.crawlie.app` registrable domain, so the session cookie is sent
// cross-subdomain (the Worker sets a domain-scoped cookie + trusts this origin).

const AUTH = import.meta.env.VITE_AUTH_URL ?? "https://api.crawlie.app";

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
};

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

/** Send the user to the hosted sign-in, returning here afterwards. */
export function signIn(): void {
  const redirect = encodeURIComponent(window.location.href);
  window.location.href = `${AUTH}/?redirect=${redirect}`;
}

export async function signOut(): Promise<void> {
  try {
    await fetch(`${AUTH}/api/auth/sign-out`, { method: "POST", credentials: "include" });
  } catch {
    /* ignore */
  }
  window.location.reload();
}
