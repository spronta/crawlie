// Loops.so integration: deliver the sign-in code as a transactional email and
// subscribe new signups to the Crawlie newsletter. Mirrors the env conventions
// already used by apps/website/api/subscribe.ts so both surfaces share one Loops
// account and audience.

import type { Env } from "./env";

const LOOPS_BASE = "https://app.loops.so/api/v1";

/** Send the one-time sign-in code via a Loops transactional email.
 *
 *  Requires LOOPS_API_KEY and LOOPS_OTP_TRANSACTIONAL_ID (a Loops transactional
 *  template whose body references the `otp` data variable). If either is missing
 *  we throw so Better Auth surfaces a clear "email not configured" error rather
 *  than silently dropping the code. */
export async function sendOtpEmail(
  env: Env,
  email: string,
  otp: string,
  type: string,
): Promise<void> {
  if (!env.LOOPS_API_KEY || !env.LOOPS_OTP_TRANSACTIONAL_ID) {
    throw new Error(
      "Email sign-in is not configured (set LOOPS_API_KEY and LOOPS_OTP_TRANSACTIONAL_ID).",
    );
  }

  const res = await fetch(`${LOOPS_BASE}/transactional`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LOOPS_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      transactionalId: env.LOOPS_OTP_TRANSACTIONAL_ID,
      email,
      dataVariables: { otp, type },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Loops transactional send failed (${res.status}): ${detail}`);
  }
}

/** Subscribe a new signup to the Crawlie newsletter. Best-effort: newsletter
 *  failures must never block account creation, so callers should not await-throw
 *  this in a way that fails signup. Returns true on success (or idempotent
 *  already-subscribed), false otherwise. */
export async function subscribeToNewsletter(
  env: Env,
  email: string,
  name?: string | null,
): Promise<boolean> {
  if (env.LOOPS_NEWSLETTER_ON_SIGNUP === "false") return false;
  if (!env.LOOPS_API_KEY) return false;

  const payload: Record<string, unknown> = { email, source: "crawlie-cloud" };
  if (name) {
    const [firstName, ...rest] = name.split(" ");
    payload.firstName = firstName;
    if (rest.length) payload.lastName = rest.join(" ");
  }
  const listId = env.LOOPS_NEWSLETTER_MAILING_LIST_ID;
  if (listId) payload.mailingLists = { [listId]: true };

  try {
    const res = await fetch(`${LOOPS_BASE}/contacts/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.LOOPS_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) return true;
    // 409 / "already on list" is a successful idempotent subscribe.
    const detail = await res.text().catch(() => "");
    return res.status === 409 || /already/i.test(detail);
  } catch {
    return false;
  }
}
