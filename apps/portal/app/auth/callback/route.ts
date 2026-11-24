import { NextRequest, NextResponse } from 'next/server';
import { env, sessionClient } from '../../../lib/server/supabase';
import { demoEnabled } from '../../../lib/config';
export async function GET(req: NextRequest) {
  const base = env('NEXT_PUBLIC_PORTAL_URL'),
    code = req.nextUrl.searchParams.get('code');
  if (!demoEnabled && code) {
    const client = await sessionClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL('/reset-password', base));
  }
  return NextResponse.redirect(new URL('/forgot-password?failed=1', base));
}
