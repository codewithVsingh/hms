import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { processPolicyRefunds } from '../../../../lib/server/policy-refunds';
import { runMaintenance, reconcileKnownPayments } from '../../../../lib/server/notifications';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || '',
    provided = req.headers.get('authorization') || '';
  const expected = 'Bearer ' + secret;
  if (
    process.env.HMS_DEMO_MODE !== 'false' ||
    secret.length < 32 ||
    Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  )
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); // Run each step independently: a notification failure must not block payment reconciliation or refunds.
  const step = async <T>(fn: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await fn();
    } catch {
      return { error: 'failed' };
    }
  };
  const result = {
    maintenance: await step(runMaintenance),
    reconciliation: await step(reconcileKnownPayments),
    policyRefunds: await step(processPolicyRefunds),
  };
  const failed = Object.values(result).some((v) => !!v && typeof v === 'object' && 'error' in v);
  return NextResponse.json(result, { status: failed ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
}
