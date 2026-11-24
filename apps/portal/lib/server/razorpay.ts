import 'server-only';
import { allowedPaymentKey } from './payment-crypto';
export { signatureValid, digest } from './payment-crypto';
import { env, rpc, serviceClient } from './supabase';
export function paymentConfig() {
  const key = env('RAZORPAY_KEY_ID');
  env('RAZORPAY_KEY_SECRET');
  const mode = process.env.HMS_RAZORPAY_MODE || 'test';
  if (!allowedPaymentKey(key, mode, process.env.HMS_ENABLE_REAL_PAYMENTS === 'true'))
    throw new Error('CONFIGURATION_REQUIRED');
  return key;
}
export async function gateway<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  paymentConfig();
  const r = await fetch('https://api.razorpay.com/v1' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization:
        'Basic ' + Buffer.from(`${env('RAZORPAY_KEY_ID')}:${env('RAZORPAY_KEY_SECRET')}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error('PAYMENT_PROVIDER_UNAVAILABLE');
  return (await r.json()) as T;
}
type Claim = {
  state: 'create' | 'existing' | 'review';
  amount: number;
  invoiceId: string;
  claim: string;
  orderId: string;
  receipt: string;
};
type Order = { id: string; amount: number; currency: string; status: string };
type Payment = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  captured: boolean;
};
export async function createOrder(userId: string, appointmentId: string) {
  const keyId = paymentConfig();
  const service = serviceClient();
  const claim = await rpc<Claim>(service, 'hms_claim_order', {
    p_user: userId,
    p_appointment: appointmentId,
  });
  if (claim.state === 'review') throw new Error('ORDER_CREATION_REVIEW');
  if (claim.state === 'existing')
    return { keyId, orderId: claim.orderId, amount: claim.amount, currency: 'INR' };
  const order = await gateway<Order>('/orders', {
    amount: claim.amount,
    currency: 'INR',
    receipt: claim.receipt,
    partial_payment: false,
  });
  if (order.amount !== claim.amount || order.currency !== 'INR' || !/^order_[A-Za-z0-9]+$/.test(order.id))
    throw new Error('PAYMENT_MISMATCH');
  await rpc(service, 'hms_attach_order', {
    p_invoice: claim.invoiceId,
    p_claim: claim.claim,
    p_order: order.id,
    p_amount: order.amount,
  });
  return { keyId, orderId: order.id, amount: order.amount, currency: 'INR' };
}
export async function settle(
  orderId: string,
  paymentId: string,
  userId: string | null,
  eventId: string | null = null,
  rawDigest: string | null = null,
) {
  if (!/^order_[A-Za-z0-9]+$/.test(orderId) || !/^pay_[A-Za-z0-9]+$/.test(paymentId))
    throw new Error('INVALID_REQUEST');
  const service = serviceClient();
  const expected = await rpc<{ amount: number; appointmentId: string } | null>(service, 'hms_lookup_order', {
    p_order: orderId,
    p_user: userId,
  });
  if (!expected) throw new Error('ORDER_NOT_FOUND');
  const p = await gateway<Payment>(`/payments/${paymentId}`);
  if (p.id !== paymentId || p.order_id !== orderId || p.amount !== expected.amount || p.currency !== 'INR')
    throw new Error('PAYMENT_MISMATCH');
  if (p.status !== 'captured' || p.captured !== true) return { status: 'pending_capture' };
  return rpc(service, 'hms_capture_payment', {
    p_order: orderId,
    p_payment: paymentId,
    p_amount: p.amount,
    p_currency: p.currency,
    p_event: eventId,
    p_digest: rawDigest,
  });
}
export async function recoverOrder(orderId: string, userId: string) {
  if (!/^order_[A-Za-z0-9]+$/.test(orderId)) throw new Error('INVALID_REQUEST');
  const expected = await rpc(serviceClient(), 'hms_lookup_order', { p_order: orderId, p_user: userId });
  if (!expected) throw new Error('ORDER_NOT_FOUND');
  const result = await gateway<{ items: Payment[] }>(`/orders/${orderId}/payments`);
  const p = result.items.find((p) => p.status === 'captured' && p.captured);
  return p ? settle(orderId, p.id, userId) : { status: 'pending_capture' };
}
type RefundAccess = {
  refundId: string;
  paymentId: string;
  amount: number;
  receipt: string;
  providerRefundId?: string | null;
};
type Refund = {
  id: string;
  payment_id: string;
  amount: number;
  currency: string;
  status: string;
  receipt: string | null;
};
async function applyRefund(ref: RefundAccess, result: Refund) {
  if (
    result.payment_id !== ref.paymentId ||
    result.amount !== ref.amount ||
    (!ref.providerRefundId && result.receipt !== ref.receipt) ||
    (ref.providerRefundId && result.id !== ref.providerRefundId) ||
    (result.currency && result.currency !== 'INR') ||
    !/^rfnd_[A-Za-z0-9]+$/.test(result.id) ||
    !['pending', 'processed', 'failed'].includes(result.status)
  )
    throw new Error('REFUND_MISMATCH');
  await rpc(serviceClient(), 'hms_apply_refund', {
    p_id: ref.refundId,
    p_provider: result.id,
    p_payment: result.payment_id,
    p_amount: result.amount,
    p_status: result.status,
  });
  return { status: result.status };
}
export async function sendRefund(ref: RefundAccess) {
  const result = await gateway<Refund>(`/payments/${ref.paymentId}/refund`, {
    amount: ref.amount,
    receipt: ref.receipt,
    speed: 'normal',
  });
  return applyRefund(ref, result);
}
export async function checkRefund(ref: RefundAccess, providerId?: string) {
  const id = ref.providerRefundId || providerId;
  if (id) {
    if (!/^rfnd_[A-Za-z0-9]+$/.test(id)) throw new Error('INVALID_REQUEST');
    const result = await gateway<Refund>(`/refunds/${id}`);
    return applyRefund(ref, result);
  }
  const list = await gateway<{ items: Refund[] }>(`/payments/${ref.paymentId}/refunds?count=100`);
  const result = list.items.find((r) => r.receipt === ref.receipt && r.amount === ref.amount);
  if (!result) throw new Error('REFUND_REVIEW');
  return applyRefund(ref, result);
}
