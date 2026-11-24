import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const allowed = () => {
  try {
    return new URL(process.env.NEXT_PUBLIC_WEBSITE_URL || '').origin;
  } catch {
    return '';
  }
};
const result = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': allowed(), Vary: 'Origin' },
  });
export async function OPTIONS(req: NextRequest) {
  return req.headers.get('origin') === allowed()
    ? new NextResponse(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': allowed(),
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          Vary: 'Origin',
        },
      })
    : new NextResponse(null, { status: 403 });
}
export async function POST(req: NextRequest) {
  try {
    const env = (k: string) => process.env[k] || '';
    if (env('HMS_DEMO_MODE') !== 'false' || env('HMS_CALLBACK_ENABLED') !== 'true')
      return result({ error: 'Callback service is not available. Contact reception.' }, 503);
    if (req.headers.get('origin') !== allowed()) return result({ error: 'Invalid origin' }, 403);
    const raw = await req.text();
    if (raw.length > 10000) return result({ error: 'Invalid request' }, 400);
    const b = JSON.parse(raw);
    if (
      !b ||
      typeof b !== 'object' ||
      typeof b.name !== 'string' ||
      b.name.trim().length < 2 ||
      b.name.trim().length > 100 ||
      typeof b.phone !== 'string' ||
      !/^\+[1-9]\d{7,14}$/.test(b.phone) ||
      !['appointment', 'hours', 'billing', 'general'].includes(b.category) ||
      b.consent !== true ||
      typeof b.token !== 'string' ||
      b.token.length > 4096
    )
      return result({ error: 'Check your details and consent.' }, 400);
    const secret = env('HMS_CALLBACK_TURNSTILE_SECRET'),
      service = env('SUPABASE_SERVICE_ROLE_KEY'),
      base = env('NEXT_PUBLIC_SUPABASE_URL');
    if (!secret || !service || !base) return result({ error: 'Callback service is not configured.' }, 503);
    const captcha = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret, response: b.token }),
      signal: AbortSignal.timeout(8000),
    });
    const verified = await captcha.json();
    if (!verified.success || verified.hostname !== new URL(allowed()).hostname)
      return result({ error: 'Security verification failed.' }, 400);
    const r = await fetch(`${base.replace(/\/$/, '')}/rest/v1/rpc/hms_v3_inquiry_submit`, {
      method: 'POST',
      headers: {
        apikey: service,
        ...(service.startsWith('eyJ') ? { Authorization: `Bearer ${service}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_slug: env('HMS_ORGANIZATION_SLUG'),
        p_branch: env('HMS_BRANCH_CODE'),
        p_name: b.name.trim(),
        p_phone: b.phone,
        p_category: b.category,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok)
      return result(
        { error: 'Could not submit. Contact reception if you have already sent a request.' },
        409,
      );
    return result({ accepted: true });
  } catch {
    return result({ error: 'Callback service unavailable.' }, 503);
  }
}
