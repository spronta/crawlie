// Vercel Edge Function: add an email to a Loops.so audience.
//
// Deployed automatically by Vercel from this `api/` directory alongside the
// static Astro build — no SSR adapter needed. Configure in the Vercel project:
//   LOOPS_API_KEY          — a Loops.so API key (Settings → API)
//   LOOPS_UPDATES_MAILING_LIST_ID  — optional; a mailing list to add subscribers to
// Until LOOPS_API_KEY is set, the endpoint replies 503 and the form shows a
// friendly note.

export const config = { runtime: 'edge' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let email = '';
  try {
    const data = (await req.json()) as { email?: unknown };
    email = typeof data.email === 'string' ? data.email.trim() : '';
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  if (!EMAIL_RE.test(email)) return json({ error: 'Please enter a valid email address.' }, 400);

  const apiKey = process.env.LOOPS_API_KEY;
  if (!apiKey) {
    return json({ error: 'Subscriptions are not configured yet — check back soon.' }, 503);
  }

  const listId = process.env.LOOPS_UPDATES_MAILING_LIST_ID;
  const payload: Record<string, unknown> = { email, source: 'changelog' };
  if (listId) payload.mailingLists = { [listId]: true };

  let res: Response;
  try {
    res = await fetch('https://app.loops.so/api/v1/contacts/create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return json({ error: 'Could not reach the subscription service. Try again.' }, 502);
  }

  if (res.ok) return json({ ok: true }, 200);

  // Loops returns 409 with `{ success: false, message: "Email already on list." }`
  // for a known contact — treat that as a successful (idempotent) subscribe.
  const detail = await res.text().catch(() => '');
  if (res.status === 409 || /already/i.test(detail)) {
    return json({ ok: true, already: true }, 200);
  }
  return json({ error: 'Could not subscribe right now. Please try again.' }, 502);
}
