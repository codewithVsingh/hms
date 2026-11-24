import 'server-only';
import { allowedPaymentKey } from './payment-crypto';

// Central list of what each live feature needs. Used by the health endpoint and docs
// (docs/ENVIRONMENT_VARIABLES.md). Reports presence only; never returns values.
const has = (k: string) => !!process.env[k];
const all = (...keys: string[]) => keys.every(has);

export type CheckState = 'ok' | 'missing' | 'disabled' | 'invalid';

export function configReport() {
  const demo =
    process.env.HMS_DEMO_MODE === 'true' ||
    (process.env.NODE_ENV === 'development' && process.env.HMS_DEMO_MODE !== 'false');
  const mode = process.env.HMS_RAZORPAY_MODE || 'test';
  const key = process.env.RAZORPAY_KEY_ID || '';
  const paymentsConfigured = all('RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET');
  const checks: Record<string, CheckState> = {
    core: all(
      'NEXT_PUBLIC_PORTAL_URL',
      'NEXT_PUBLIC_WEBSITE_URL',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'HMS_ORGANIZATION_SLUG',
      'HMS_BRANCH_CODE',
    )
      ? 'ok'
      : 'missing',
    patientNotice: all('HMS_NOTICE_VERSION', 'HMS_NOTICE_URL') ? 'ok' : 'missing',
    captcha: has('NEXT_PUBLIC_TURNSTILE_SITE_KEY') ? 'ok' : 'missing',
    payments: !paymentsConfigured
      ? 'missing'
      : allowedPaymentKey(key, mode, process.env.HMS_ENABLE_REAL_PAYMENTS === 'true')
        ? 'ok'
        : 'invalid',
    worker: (process.env.CRON_SECRET || '').length >= 32 ? 'ok' : 'missing',
    scanner:
      (process.env.HMS_PRIVATE_SCANNER_URL || '').startsWith('https://') && has('HMS_PRIVATE_SCANNER_TOKEN')
        ? 'ok'
        : 'missing',
    callbacks:
      process.env.HMS_CALLBACK_ENABLED !== 'true'
        ? 'disabled'
        : has('HMS_CALLBACK_TURNSTILE_SECRET')
          ? 'ok'
          : 'missing',
    email:
      process.env.HMS_NOTIFY_EMAIL !== 'true'
        ? 'disabled'
        : all('RESEND_API_KEY', 'HMS_FROM_EMAIL')
          ? 'ok'
          : 'missing',
    sms:
      process.env.HMS_NOTIFY_SMS !== 'true'
        ? 'disabled'
        : all('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM')
          ? 'ok'
          : 'missing',
    whatsapp:
      process.env.HMS_NOTIFY_WHATSAPP !== 'true'
        ? 'disabled'
        : all(
              'WHATSAPP_ACCESS_TOKEN',
              'WHATSAPP_PHONE_NUMBER_ID',
              'WHATSAPP_GRAPH_VERSION',
              'HMS_WA_TEMPLATE_MAP',
            )
          ? 'ok'
          : 'missing',
  };
  // Live mode needs the core set; everything else degrades a single feature.
  const ready = demo || checks.core === 'ok';
  return {
    mode: demo ? 'demo' : 'live',
    paymentMode: mode === 'live' ? 'live' : 'test',
    ready,
    checks,
  };
}
