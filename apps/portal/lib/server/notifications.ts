import 'server-only';
import { env, rpc, scope, serviceClient } from './supabase';
import { gateway, settle, checkRefund, paymentConfig } from './razorpay';
type Job = {
  id: string;
  lease: string;
  channel: 'email' | 'sms' | 'whatsapp';
  template: string;
  recipient: string;
};
const texts: Record<string, string> = {
  payment_received: 'A payment was received. Sign in to view your receipt.',
  refund_processed: 'A refund was processed. Sign in or contact reception for details.',
  record_available: 'A document is available in your patient portal. Sign in securely.',
  appointment_confirmed: 'Your appointment has been confirmed. Sign in to the hospital portal for details.',
  appointment_changed: 'Your appointment details have changed. Sign in to the hospital portal for details.',
  appointment_cancelled:
    'Your appointment has been cancelled. Sign in to the hospital portal or contact reception.',
  reminder_24h: 'You have an upcoming appointment. Sign in to the hospital portal for details.',
  reminder_1h: 'You have an upcoming appointment. Sign in to the hospital portal for details.',
};
function channels() {
  const c: string[] = [];
  if (process.env.HMS_NOTIFY_EMAIL === 'true' && process.env.RESEND_API_KEY && process.env.HMS_FROM_EMAIL)
    c.push('email');
  if (
    process.env.HMS_NOTIFY_SMS === 'true' &&
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM
  )
    c.push('sms');
  if (
    process.env.HMS_NOTIFY_WHATSAPP === 'true' &&
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_GRAPH_VERSION &&
    process.env.HMS_WA_TEMPLATE_MAP
  )
    c.push('whatsapp');
  return c;
}
async function deliver(j: Job) {
  const msg = texts[j.template];
  if (!msg) throw new Error('Unknown template');
  let response: Response;
  if (j.channel === 'email') {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': j.id,
      },
      body: JSON.stringify({
        from: env('HMS_FROM_EMAIL'),
        to: [j.recipient],
        subject: 'Hospital appointment update',
        text: msg,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } else if (j.channel === 'sms') {
    const sid = env('TWILIO_ACCOUNT_SID');
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: env('TWILIO_FROM'),
          To: j.recipient.startsWith('+') ? j.recipient : '+' + j.recipient,
          Body: msg,
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
  } else {
    const version = env('WHATSAPP_GRAPH_VERSION'),
      id = env('WHATSAPP_PHONE_NUMBER_ID');
    if (!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(id)) throw new Error('Invalid provider configuration');
    const map = JSON.parse(env('HMS_WA_TEMPLATE_MAP')) as Record<string, string>;
    if (!map[j.template]) throw new Error('Approved template not configured');
    response = await fetch(`https://graph.facebook.com/${version}/${id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env('WHATSAPP_ACCESS_TOKEN')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: j.recipient.replace(/\D/g, ''),
        type: 'template',
        template: { name: map[j.template], language: { code: process.env.HMS_WA_LANGUAGE || 'en' } },
      }),
      signal: AbortSignal.timeout(8000),
    });
  }
  if (response.status === 429) return { state: 'retry', provider: '' };
  if (!response.ok) return { state: 'dead_letter', provider: '' };
  const d = await response.json();
  return { state: 'sent', provider: String(d.id || d.sid || d.messages?.[0]?.id || 'accepted') };
}
export async function runMaintenance() {
  const service = serviceClient(),
    slots = await rpc<number>(service, 'hms_v3_maintenance', scope()),
    jobs = await rpc<Job[]>(service, 'hms_v3_claim_notifications', { ...scope(), p_channels: channels() });
  let accepted = 0;
  await Promise.all(
    jobs.map(async (j) => {
      let result = { state: 'dead_letter', provider: '' };
      try {
        result = await deliver(j);
      } catch {
        /* Unknown send outcome; review rather than blindly retry. */
      }
      await rpc(service, 'hms_v3_finish_notification', {
        p_id: j.id,
        p_lease: j.lease,
        p_state: result.state,
        p_provider: result.provider,
      });
      if (result.state === 'sent') accepted++;
    }),
  );
  return { slotsGenerated: slots, jobsClaimed: jobs.length, accepted };
}

export async function reconcileKnownPayments() {
  if (process.env.HMS_RECONCILIATION_ENABLED !== 'true') return { checked: 0, review: 0 };
  paymentConfig();
  const service = serviceClient();
  const candidates = await rpc<{
    orders: { orderId: string }[];
    refunds: Parameters<typeof checkRefund>[0][];
  }>(service, 'hms_v3_reconciliation_candidates', scope());
  let checked = 0,
    review = 0;
  await Promise.all([
    ...candidates.orders.map(async ({ orderId }) => {
      try {
        if (!/^order_[A-Za-z0-9]+$/.test(orderId)) throw new Error('Invalid order');
        const result = await gateway<{ items: { id: string; status: string; captured: boolean }[] }>(
          `/orders/${orderId}/payments`,
        );
        for (const p of result.items.filter((x) => x.status === 'captured' && x.captured))
          await settle(orderId, p.id, null);
        checked++;
      } catch {
        review++;
      }
    }),
    ...candidates.refunds.map(async (r) => {
      try {
        await checkRefund(r);
        checked++;
      } catch {
        review++;
      }
    }),
  ]);
  return { checked, review };
}
