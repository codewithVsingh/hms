const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { signatureValid, digest, allowedPaymentKey } = require('../apps/portal/lib/server/payment-crypto.ts');
test('valid checkout signature and strict tampering rejection', () => {
  const s = createHmac('sha256', 'test-secret').update('order_abc|pay_xyz').digest('hex');
  assert.equal(signatureValid('order_abc|pay_xyz', s, 'test-secret'), true);
  assert.equal(signatureValid('order_abc|pay_other', s, 'test-secret'), false);
  assert.equal(signatureValid('order_abc|pay_xyz', s, 'wrong-secret'), false);
  for (const malformed of ['', 'abc', 'z'.repeat(64), '0'.repeat(63), '0'.repeat(65)])
    assert.equal(signatureValid('order_abc|pay_xyz', malformed, 'test-secret'), false);
});
test('webhook signatures bind raw bytes', () => {
  const raw = '{"event":"payment.captured"}';
  const s = createHmac('sha256', 'hook-secret').update(raw).digest('hex');
  assert.equal(signatureValid(raw, s, 'hook-secret'), true);
  assert.equal(signatureValid(raw + ' ', s, 'hook-secret'), false);
  assert.notEqual(digest(raw), digest(raw + ' '));
});
test('test and real payment key modes cannot be mixed', () => {
  assert.equal(allowedPaymentKey('rzp_test_abc', 'test', false), true);
  assert.equal(allowedPaymentKey('rzp_live_abc', 'test', true), false);
  assert.equal(allowedPaymentKey('rzp_live_abc', 'live', false), false);
  assert.equal(allowedPaymentKey('rzp_test_abc', 'live', true), false);
  assert.equal(allowedPaymentKey('rzp_live_abc', 'live', true), true);
  assert.equal(allowedPaymentKey('rzp_live_abc', 'unknown', true), false);
});
const sql = (n) => readFileSync(`supabase/migrations/${n}`, 'utf8');
// Formatting-insensitive view of TS/JS source for static guards: drops whitespace around
// punctuation and trailing commas, so Prettier line-wrapping does not break the assertions.
const code = (path) =>
  readFileSync(path, 'utf8')
    .replace(/\s*([(){}\[\];,:=!<>+&|?.'"`])\s*/g, '$1')
    .replace(/,([)\]}])/g, '$1')
    .replace(/\s+/g, ' ');
test('static guard: payment and refund settlement service-only grants', () => {
  const payment = sql('202611240007_payment_engine.sql'),
    refund = sql('202611240010_refund_review.sql');
  assert.match(
    payment,
    /REVOKE ALL ON FUNCTION[\s\S]*hms_capture_payment[\s\S]*FROM PUBLIC,anon,authenticated/,
  );
  assert.match(payment, /GRANT EXECUTE ON FUNCTION[\s\S]*hms_capture_payment[\s\S]*TO service_role/);
  assert.match(refund, /GRANT EXECUTE ON FUNCTION public\.hms_apply_refund[^;]+ TO service_role/);
  assert.doesNotMatch(refund, /GRANT EXECUTE ON FUNCTION[^;]*hms_apply_refund[^;]*TO authenticated/);
});
test('static guard: slot uniqueness, row locking and staff MFA', () => {
  assert.match(sql('202611240002_appointments_clinical.sql'), /one_live_appointment_per_slot/);
  assert.match(sql('202611240006_booking_engine.sql'), /WHERE id=p_slot FOR UPDATE/);
  assert.match(sql('202611240007_payment_engine.sql'), /a\.hold_expires_at>now\(\)/);
  assert.match(sql('202611240008_operations.sql'), /auth\.jwt\(\)->>'aal'\)='aal2'/);
});
test('static guard: webhook bypasses browser CSRF only after signature validation and live API disabled in demo', () => {
  const src = code('apps/portal/app/api/v1/[...action]/route.ts');
  assert.match(src, /if\(demoEnabled\)return reply/);
  assert.match(src, /signatureValid\(raw,sig,env\('RAZORPAY_WEBHOOK_SECRET'\)\)/);
  assert.match(src, /sameOrigin\(req\)/);
});
const { runInNewContext } = require('node:vm');
test('portal-only PWA, no authenticated cache writes', () => {
  const sw = code('apps/portal/public/sw.js');
  assert.match(sw, /cache:'no-store'/);
  assert.doesNotMatch(sw, /caches\.open|cache\.put|cache\.add|localStorage|indexedDB/);
  assert.match(sw, /req\.mode!=='navigate'/);
  assert.match(code('apps/portal/app/manifest.ts'), /start_url:'\/login'/);
  assert.doesNotMatch(code('apps/website/app/layout.tsx'), /PortalPWA|manifest.webmanifest/);
});
test('PWA network failure returns safe generic fallback, not a stored record', async () => {
  const handlers = {};
  const context = {
    self: {
      location: { origin: 'https://portal.example.test' },
      addEventListener: (k, f) => (handlers[k] = f),
    },
    URL,
    Response,
    fetch: async () => {
      throw Error('offline');
    },
  };
  runInNewContext(readFileSync('apps/portal/public/sw.js', 'utf8'), context);
  let result;
  handlers.fetch({
    request: { method: 'GET', mode: 'navigate', url: 'https://portal.example.test/doctor/care' },
    respondWith: (p) => (result = p),
  });
  const r = await result;
  assert.equal(r.status, 503);
  assert.match(await r.text(), /patient records and payment information are not stored offline/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  let called = false;
  handlers.fetch({
    request: { method: 'POST', mode: 'cors', url: 'https://portal.example.test/api/v2/care/record' },
    respondWith: () => (called = true),
  });
  assert.equal(called, false);
});
test('phase 3 service-only document creation, notification and reconciliation', () => {
  assert.match(
    sql('202611240014_team_and_documents.sql'),
    /GRANT EXECUTE ON FUNCTION public\.hms_v3_link_invite[^;]+ TO service_role/,
  );
  assert.match(
    sql('202611240013_notifications.sql'),
    /GRANT EXECUTE ON FUNCTION public\.hms_v3_maintenance[^;]+ TO service_role/,
  );
  assert.match(
    sql('202611240016_reconciliation_and_events.sql'),
    /GRANT EXECUTE ON FUNCTION public\.hms_v3_reconciliation_candidates\(text,text\) TO service_role/,
  );
  assert.match(sql('202611240011_clinical_records.sql'), /hms_private\.v3_clinical_access/);
});
