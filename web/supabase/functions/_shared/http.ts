// Shared request plumbing for the Groq-proxy edge functions. Both are
// deployed --no-verify-jwt (anonymous browsers call them), so this is the
// only thing standing between the public internet and the Groq quota:
//
//   - CORS is limited to ALLOWED_ORIGINS (comma-separated, e.g.
//     "https://www.cardfit.me,https://cardfit.me"). Unset = allow any origin,
//     which keeps local dev working but should never be left that way in prod.
//     Note CORS only stops other *websites*; scripts ignore it, hence:
//   - a best-effort per-IP rate limit. It's in-memory, so it resets when the
//     isolate recycles and isn't shared across regions — enough to blunt a
//     casual loop, not a determined attacker (use Upstash/Postgres for that).
//   - a hard cap on request body size.
//
// Set with: npx supabase secrets set ALLOWED_ORIGINS=https://www.cardfit.me

const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const RATE_LIMIT = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '20');
const MAX_BODY_BYTES = 8_000;

const hits = new Map<string, { count: number; resetAt: number }>();

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowOrigin = ALLOWED.length === 0 ? '*' : ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'content-type, authorization, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function rateLimited(req: Request): boolean {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    if (hits.size > 10_000) hits.clear(); // bound memory
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

export type Json = (body: unknown, status?: number) => Response;

/** Wraps a JSON POST handler with CORS, origin, rate-limit and size checks. */
export function serveJson(handler: (body: Record<string, unknown>, json: Json) => Promise<Response>) {
  Deno.serve(async (req) => {
    const cors = corsHeaders(req);
    const json: Json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

    const origin = req.headers.get('origin');
    if (ALLOWED.length && origin && !ALLOWED.includes(origin)) return json({ error: 'origin not allowed' }, 403);
    if (rateLimited(req)) return json({ error: 'rate limited' }, 429);

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'body too large' }, 413);
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw);
      body = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return json({ error: 'invalid JSON' }, 400);
    }
    return handler(body, json);
  });
}

/** Clamp untrusted text before it goes into a prompt. */
export function clip(value: unknown, max: number): string {
  return String(value ?? '').replace(/[\u0000-\u001f]+/g, ' ').slice(0, max);
}
