import 'server-only';
import { rpc, scope, serviceClient } from './supabase';
import { paymentConfig, sendRefund } from './razorpay';
export async function tryPolicyRefund(id: string) {
  paymentConfig();
  const ref = await rpc<Parameters<typeof sendRefund>[0] | null>(
    serviceClient(),
    'hms_v4_claim_requested_refund',
    { p_id: id },
  );
  if (!ref) return false;
  await sendRefund(ref);
  return true;
}
export async function processPolicyRefunds() {
  if (process.env.HMS_AUTO_POLICY_REFUNDS !== 'true') return { claimed: 0, review: 0 };
  paymentConfig();
  const ids = await rpc<string[]>(serviceClient(), 'hms_v4_requested_refunds', scope());
  let claimed = 0,
    review = 0;
  await Promise.all(
    ids.map(async (id) => {
      try {
        if (await tryPolicyRefund(id)) claimed++;
      } catch {
        review++;
      }
    }),
  );
  return { claimed, review };
}
