// Vercel Edge Function: add an email to a Resend audience.
//
// Deployed automatically by Vercel from this `api/` directory alongside the
// static Astro build — no SSR adapter needed. Configure two env vars in the
// Vercel project:
//   RESEND_API_KEY      — a Resend API key
//   RESEND_AUDIENCE_ID  — the audience to add subscribers to
// Until both are set, the endpoint replies 503 and the form shows a friendly note.

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

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    return json({ error: 'Subscriptions are not configured yet — check back soon.' }, 503);
  }

  let res: Response;
  try {
    res = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, unsubscribed: false }),
    });
  } catch {
    return json({ error: 'Could not reach the subscription service. Try again.' }, 502);
  }

  if (res.ok) return json({ ok: true }, 200);

  // Treat an already-subscribed contact as success.
  const detail = await res.text().catch(() => '');
  if (res.status === 409 || /already|exists/i.test(detail)) {
    return json({ ok: true, already: true }, 200);
  }
  return json({ error: 'Could not subscribe right now. Please try again.' }, 502);
}
