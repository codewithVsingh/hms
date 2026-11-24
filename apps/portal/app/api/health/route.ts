import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { configReport } from '../../../lib/server/config-check';
import { rpc, scope, serviceClient } from '../../../lib/server/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public: { status } only, for uptime monitors and load balancers.
// With "Authorization: Bearer <CRON_SECRET>": configuration presence report and a database
// round trip. Never returns secret values, patient data or error details.
function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET || '';
  const provided = req.headers.get('authorization') || '';
  const expected = 'Bearer ' + secret;
  return (
    secret.length >= 32 &&
    Buffer.byteLength(provided) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  );
}

export async function GET(req: NextRequest) {
  const report = configReport();
  const headers = { 'Cache-Control': 'no-store' };
  if (!authorized(req)) {
    return NextResponse.json(
      { status: report.ready ? 'ok' : 'degraded' },
      { status: report.ready ? 200 : 503, headers },
    );
  }
  let database: 'ok' | 'error' | 'skipped' = 'skipped';
  if (report.mode === 'live' && report.checks.core === 'ok') {
    try {
      await rpc(serviceClient(), 'hms_v4_policy', scope());
      database = 'ok';
    } catch {
      database = 'error';
    }
  }
  const healthy = report.ready && database !== 'error';
  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', time: new Date().toISOString(), ...report, database },
    { status: healthy ? 200 : 503, headers },
  );
}
