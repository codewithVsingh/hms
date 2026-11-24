-- Behavioural database tests. Run ONLY against a disposable local database created by
-- supabase/tests/local/run.sh (shim + all migrations). Uses synthetic users and test-mode data.
-- Each scenario impersonates a caller by setting request.jwt.claims and switching role, so the
-- real grants, SECURITY DEFINER checks and RLS are exercised exactly as the API would hit them.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

CREATE SCHEMA hms_test;
GRANT USAGE ON SCHEMA hms_test TO anon, authenticated, service_role;
CREATE TABLE hms_test.ctx (k text PRIMARY KEY, v text NOT NULL);
GRANT SELECT ON hms_test.ctx TO anon, authenticated, service_role;
CREATE FUNCTION hms_test.get(p_k text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT v FROM hms_test.ctx WHERE k = p_k $$;
CREATE FUNCTION hms_test.put(p_k text, p_v text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO hms_test.ctx VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = excluded.v $$;
-- Runs as the CALLER (not security definer): asserts the statement fails with the given message.
CREATE FUNCTION hms_test.expect_error(p_sql text, p_expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE p_expected THEN RETURN; END IF;
    RAISE EXCEPTION 'FAIL: % -> expected "%", got "%"', p_sql, p_expected, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL: % -> expected error "%", but it succeeded', p_sql, p_expected;
END $$;
CREATE FUNCTION hms_test.ok(p_cond boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF; END $$;
CREATE FUNCTION hms_test.claims(p_user uuid, p_aal text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'aal', p_aal, 'role', 'authenticated')::text, true) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hms_test TO anon, authenticated, service_role;
-- Read-only access to test context for the service role helper statements.
GRANT INSERT, UPDATE ON hms_test.ctx TO authenticated, service_role;

-- ---------------------------------------------------------------- fixture (synthetic only)
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'admin@example.test', now()),
  ('a0000000-0000-4000-8000-000000000002', 'doctor@example.test', now()),
  ('a0000000-0000-4000-8000-000000000003', 'reception@example.test', now());
INSERT INTO auth.users (id, phone, phone_confirmed_at) VALUES
  ('a0000000-0000-4000-8000-00000000000a', '+919000000001', now()),
  ('a0000000-0000-4000-8000-00000000000b', '+919000000002', now());
INSERT INTO auth.users (id, phone) VALUES ('a0000000-0000-4000-8000-00000000000c', '+919000000003');
INSERT INTO auth.users (id, phone, phone_confirmed_at)
  SELECT ('c0000000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid, '+91910000000' || g, now()
  FROM generate_series(10, 29) g;

\i :provision

SELECT hms_test.put('org', id::text) FROM hms.organizations WHERE slug = 'test-hospital';
SELECT hms_test.put('branch', b.id::text) FROM hms.branches b JOIN hms.organizations o ON o.id = b.organization_id WHERE o.slug = 'test-hospital';
SELECT hms_test.put('doctor', d.id::text) FROM hms.doctors d JOIN hms.organizations o ON o.id = d.organization_id WHERE o.slug = 'test-hospital';
SELECT hms_test.put('reception_member', m.id::text) FROM hms.memberships m WHERE m.user_id = 'a0000000-0000-4000-8000-000000000003';
SELECT hms_test.put('admin_member', m.id::text) FROM hms.memberships m WHERE m.user_id = 'a0000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------- T1 anonymous caller
BEGIN;
SET LOCAL ROLE anon;
SELECT hms_test.expect_error($$SELECT public.hms_v4_book_self('test-hospital','MAIN',gen_random_uuid(),'X Y','hospital',gen_random_uuid(),'v1',true,0,1)$$, 'permission denied%');
SELECT hms_test.expect_error($$SELECT count(*) FROM hms.appointments$$, 'permission denied%');
SELECT hms_test.expect_error($$SELECT public.hms_staff_context('test-hospital','MAIN')$$, 'permission denied%');
SELECT hms_test.ok(public.hms_v4_policy('test-hospital','MAIN') IS NOT NULL, 'anon can read public cancellation policy');
COMMIT;
\echo 'ok T1 anonymous callers cannot book, read tables or reach staff RPCs'

-- ---------------------------------------------------------------- T2 staff MFA and admin setup
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000001', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok(public.hms_staff_context('test-hospital','MAIN') IS NULL, 'staff context denied without MFA (aal1)');
SELECT hms_test.expect_error(format('SELECT public.hms_admin_settings(%L,%L,true,true)', hms_test.get('org'), hms_test.get('branch')), 'FORBIDDEN');
COMMIT;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000001', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok(public.hms_staff_context('test-hospital','MAIN') IS NOT NULL, 'admin context with MFA');
SELECT public.hms_admin_settings(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, true, true);
SELECT public.hms_admin_doctor(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, hms_test.get('doctor')::uuid, 50000, true);
SELECT public.hms_admin_add_schedule(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, hms_test.get('doctor')::uuid, d::smallint, '00:00', '23:59', 15::smallint)
  FROM generate_series(0, 6) d;
SELECT hms_test.ok((public.hms_staff_generate(hms_test.get('org')::uuid, hms_test.get('branch')::uuid))::int > 0, 'slots generated');
-- Cancellation policy: Rs 100 deduction inside 24 hours (synthetic test values, not a recommendation).
SELECT hms_test.ok((public.hms_v4_policy_set(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, 10000, 24, 1)->>'version')::int = 2, 'policy version bumped');
SELECT hms_test.expect_error(format('SELECT public.hms_v4_policy_set(%L,%L,0,24,1)', hms_test.get('org'), hms_test.get('branch')), 'POLICY_CHANGED');
-- An admin cannot change their own roles.
SELECT hms_test.expect_error(format('SELECT public.hms_v3_roles(%L,%L,%L,ARRAY[''super_admin''])', hms_test.get('org'), hms_test.get('branch'), hms_test.get('admin_member')), 'FORBIDDEN');
COMMIT;
\echo 'ok T2 staff RPCs require MFA; admin configures doctor, schedule, slots, policy; no self role change'

-- Slots used below (picked as postgres so the test is independent of the time of day).
-- A slot 2-3 hours ahead is inserted explicitly so the "inside 24 hours" deduction is deterministic.
INSERT INTO hms.appointment_slots (organization_id, branch_id, doctor_id, starts_at, ends_at)
  SELECT hms_test.get('org')::uuid, hms_test.get('branch')::uuid, hms_test.get('doctor')::uuid,
         date_trunc('hour', now()) + interval '3 hours', date_trunc('hour', now()) + interval '3 hours 15 minutes'
  ON CONFLICT DO NOTHING;
SELECT hms_test.put('near_slot', id::text) FROM hms.appointment_slots
  WHERE doctor_id = hms_test.get('doctor')::uuid AND starts_at = date_trunc('hour', now()) + interval '3 hours';
SELECT hms_test.put('far_slot', id::text) FROM hms.appointment_slots
  WHERE doctor_id = hms_test.get('doctor')::uuid AND starts_at > now() + interval '5 days' ORDER BY starts_at LIMIT 1;
SELECT hms_test.put('held_slot', id::text) FROM hms.appointment_slots
  WHERE doctor_id = hms_test.get('doctor')::uuid AND starts_at > now() + interval '6 days' ORDER BY starts_at LIMIT 1;
SELECT hms_test.put('limit_slot', id::text) FROM hms.appointment_slots
  WHERE doctor_id = hms_test.get('doctor')::uuid AND starts_at > now() + interval '7 days' ORDER BY starts_at LIMIT 1;
SELECT hms_test.put('req1', gen_random_uuid()::text);

-- ---------------------------------------------------------------- T3 patient booking rules
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000c', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.expect_error(format('SELECT public.hms_v4_book_self(%L,%L,%L,%L,%L,gen_random_uuid(),%L,true,50000,2)', 'test-hospital','MAIN', hms_test.get('held_slot'), 'Unverified User', 'online', 'v1'), 'PHONE_VERIFICATION_REQUIRED');
COMMIT;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000a', 'aal1');
SET LOCAL ROLE authenticated;
-- Stale policy version and tampered fee are rejected by the server.
SELECT hms_test.expect_error(format('SELECT public.hms_v4_book_self(%L,%L,%L,%L,%L,gen_random_uuid(),%L,true,50000,1)', 'test-hospital','MAIN', hms_test.get('held_slot'), 'Patient Alpha', 'online', 'v1'), 'POLICY_CHANGED');
SELECT hms_test.expect_error(format('SELECT public.hms_v4_book_self(%L,%L,%L,%L,%L,gen_random_uuid(),%L,true,100,2)', 'test-hospital','MAIN', hms_test.get('held_slot'), 'Patient Alpha', 'online', 'v1'), 'FEE_CHANGED');
SELECT hms_test.put('held_appt', (public.hms_v4_book_self('test-hospital','MAIN', hms_test.get('held_slot')::uuid, 'Patient Alpha', 'online', hms_test.get('req1')::uuid, 'v1', true, 50000, 2)->>'id'));
-- Retrying the same request (double click / network retry) returns the same booking.
SELECT hms_test.ok(public.hms_v4_book_self('test-hospital','MAIN', hms_test.get('held_slot')::uuid, 'Patient Alpha', 'online', hms_test.get('req1')::uuid, 'v1', true, 50000, 2)->>'id' = hms_test.get('held_appt'), 'idempotent retry returns same booking');
COMMIT;
DO $$ BEGIN
  PERFORM hms_test.ok((SELECT count(*) FROM hms.appointments WHERE slot_id = hms_test.get('held_slot')::uuid) = 1, 'exactly one appointment after retry');
  PERFORM hms_test.ok((SELECT status FROM hms.appointments WHERE id = hms_test.get('held_appt')::uuid) = 'held', 'online booking is held until payment');
  PERFORM hms_test.ok((SELECT reference FROM hms.appointments WHERE id = hms_test.get('held_appt')::uuid) ~ '^BK-[A-Z0-9]{7}$', 'short booking reference assigned');
  PERFORM hms_test.ok((SELECT fee_paise FROM hms.appointments WHERE id = hms_test.get('held_appt')::uuid) = 50000, 'fee taken from server');
END $$;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000b', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.expect_error(format('SELECT public.hms_v4_book_self(%L,%L,%L,%L,%L,gen_random_uuid(),%L,true,50000,2)', 'test-hospital','MAIN', hms_test.get('held_slot'), 'Patient Beta', 'online', 'v1'), 'SLOT_UNAVAILABLE');
COMMIT;
\echo 'ok T3 phone verification, policy/fee tamper rejection, idempotent retry, held slot not double-booked'

-- ---------------------------------------------------------------- T4 payment capture (server/service role)
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000a', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.put('far_appt', (public.hms_v4_book_self('test-hospital','MAIN', hms_test.get('far_slot')::uuid, 'Patient Alpha', 'online', gen_random_uuid(), 'v1', true, 50000, 2)->>'id'));
SELECT hms_test.put('near_appt', (public.hms_v4_book_self('test-hospital','MAIN', hms_test.get('near_slot')::uuid, 'Patient Alpha', 'online', gen_random_uuid(), 'v1', true, 50000, 2)->>'id'));
-- Fourth active future booking for the same account is refused.
SELECT hms_test.expect_error(format('SELECT public.hms_v4_book_self(%L,%L,%L,%L,%L,gen_random_uuid(),%L,true,50000,2)', 'test-hospital','MAIN', hms_test.get('limit_slot'), 'Patient Alpha', 'online', 'v1'), 'BOOKING_LIMIT');
-- Browser roles cannot call the payment RPCs.
SELECT hms_test.expect_error(format('SELECT public.hms_capture_payment(%L,%L,50000,%L,NULL,NULL)', 'order_X', 'pay_X', 'INR'), 'permission denied%');
COMMIT;
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE c jsonb; appt text; n int := 0;
BEGIN
  FOREACH appt IN ARRAY ARRAY['far_appt', 'near_appt'] LOOP
    n := n + 1;
    c := public.hms_claim_order('a0000000-0000-4000-8000-00000000000a', hms_test.get(appt)::uuid);
    PERFORM hms_test.ok(c->>'state' = 'create' AND (c->>'amount')::bigint = 50000, 'order claim uses server amount');
    PERFORM hms_test.ok(public.hms_claim_order('a0000000-0000-4000-8000-00000000000a', hms_test.get(appt)::uuid)->>'state' = 'review', 'second concurrent claim is not allowed to create another order');
    PERFORM public.hms_attach_order((c->>'invoiceId')::uuid, (c->>'claim')::uuid, 'order_TEST' || n, 50000);
    PERFORM hms_test.ok(public.hms_claim_order('a0000000-0000-4000-8000-00000000000a', hms_test.get(appt)::uuid)->>'state' = 'existing', 'repeat pay click reuses the order');
    -- Another user cannot look up this order.
    PERFORM hms_test.ok(public.hms_lookup_order('order_TEST' || n, 'a0000000-0000-4000-8000-00000000000b') IS NULL, 'order not visible to another user');
    PERFORM hms_test.expect_error(format('SELECT public.hms_capture_payment(%L,%L,49999,%L,NULL,NULL)', 'order_TEST' || n, 'pay_TEST' || n, 'INR'), 'PAYMENT_MISMATCH');
    PERFORM public.hms_capture_payment('order_TEST' || n, 'pay_TEST' || n, 50000, 'INR', 'evt_TEST' || n, repeat('a', 64));
    -- Duplicate webhook delivery and browser verify for the same payment are idempotent.
    PERFORM public.hms_capture_payment('order_TEST' || n, 'pay_TEST' || n, 50000, 'INR', 'evt_TEST' || n, repeat('a', 64));
    PERFORM public.hms_capture_payment('order_TEST' || n, 'pay_TEST' || n, 50000, 'INR', NULL, NULL);
  END LOOP;
END $$;
COMMIT;
DO $$ BEGIN
  PERFORM hms_test.ok((SELECT count(*) FROM hms.payments WHERE provider_payment_id IN ('pay_TEST1','pay_TEST2')) = 2, 'one payment row per provider payment despite duplicates');
  PERFORM hms_test.ok((SELECT count(*) FROM hms.webhook_events WHERE provider_event_id IN ('evt_TEST1','evt_TEST2')) = 2, 'webhook events de-duplicated');
  PERFORM hms_test.ok((SELECT bool_and(status = 'confirmed') FROM hms.appointments WHERE id IN (hms_test.get('far_appt')::uuid, hms_test.get('near_appt')::uuid)), 'captured bookings confirmed');
END $$;
\echo 'ok T4 server-side amount, single order per invoice, duplicate webhooks idempotent, mismatches rejected, booking limit'

-- ---------------------------------------------------------------- T5 cross-patient access (IDOR/BOLA)
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000b', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.expect_error(format('SELECT public.hms_v4_cancel_quote(%L)', hms_test.get('far_appt')), 'FORBIDDEN');
SELECT hms_test.expect_error(format('SELECT public.hms_v4_cancel(%L,50000,0,50000,2,%L)', hms_test.get('far_appt'), hms_test.get('far_slot')), 'FORBIDDEN');
SELECT hms_test.ok(public.hms_v4_find_booking('test-hospital','MAIN', (SELECT 'x'), 'Patient Alpha') IS NULL, 'garbage reference finds nothing');
COMMIT;
-- Even with the right reference and name, a different verified account cannot open the booking.
SELECT hms_test.put('far_ref', reference) FROM hms.appointments WHERE id = hms_test.get('far_appt')::uuid;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000b', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok(public.hms_v4_find_booking('test-hospital','MAIN', hms_test.get('far_ref'), 'Patient Alpha') IS NULL, 'reference + name is not enough without owning the booking');
SELECT hms_test.ok(public.hms_staff_context('test-hospital','MAIN') IS NULL, 'patient has no staff context');
COMMIT;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000a', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok(public.hms_v4_find_booking('test-hospital','MAIN', lower(hms_test.get('far_ref')), 'patient alpha') IS NOT NULL, 'owner finds own booking');
COMMIT;
\echo 'ok T5 another patient cannot quote, cancel or look up a booking they do not own'

-- ---------------------------------------------------------------- T6 cancellation and refund calculation
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000a', 'aal1');
SET LOCAL ROLE authenticated;
DO $$
DECLARE q jsonb;
BEGIN
  q := public.hms_v4_cancel_quote(hms_test.get('far_appt')::uuid);
  PERFORM hms_test.ok((q->>'eligible')::boolean AND (q->>'paidPaise')::bigint = 50000 AND (q->>'deductionPaise')::bigint = 0 AND (q->>'refundPaise')::bigint = 50000, 'free cancellation outside 24h: ' || q::text);
  q := public.hms_v4_cancel_quote(hms_test.get('near_appt')::uuid);
  PERFORM hms_test.ok((q->>'eligible')::boolean AND (q->>'deductionPaise')::bigint = 10000 AND (q->>'refundPaise')::bigint = 40000, 'late cancellation deducts policy fee: ' || q::text);
  -- Client-supplied amounts that differ from the server quote are rejected.
  PERFORM hms_test.expect_error(format('SELECT public.hms_v4_cancel(%L,50000,0,50000,2,%L)', hms_test.get('near_appt'), hms_test.get('near_slot')), 'QUOTE_CHANGED');
  q := public.hms_v4_cancel(hms_test.get('near_appt')::uuid, 50000, 10000, 40000, 2, hms_test.get('near_slot')::uuid);
  PERFORM hms_test.ok((q->>'cancelled')::boolean AND q->>'refundStatus' = 'requested', 'cancelled with refund requested');
  PERFORM hms_test.put('near_refund', q->>'refundId');
  -- Repeating the confirmation returns the existing outcome, no second refund.
  q := public.hms_v4_cancel(hms_test.get('near_appt')::uuid, 50000, 10000, 40000, 2, hms_test.get('near_slot')::uuid);
  PERFORM hms_test.ok(q->>'refundId' = hms_test.get('near_refund'), 'repeat cancellation is idempotent');
END $$;
COMMIT;
DO $$ BEGIN
  PERFORM hms_test.ok((SELECT count(*) FROM hms.refunds r JOIN hms.payments p ON p.id = r.payment_id WHERE p.provider_payment_id = 'pay_TEST2') = 1, 'exactly one refund row');
  PERFORM hms_test.ok((SELECT amount_paise FROM hms.refunds WHERE id = hms_test.get('near_refund')::uuid) = 40000, 'refund amount persisted from server calculation');
  PERFORM hms_test.ok((SELECT status FROM hms.appointments WHERE id = hms_test.get('near_appt')::uuid) = 'cancelled', 'appointment cancelled');
END $$;
-- The freed slot can be booked again.
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000b', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok(public.hms_v4_book_self('test-hospital','MAIN', hms_test.get('near_slot')::uuid, 'Patient Beta', 'hospital', gen_random_uuid(), 'v1', true, 50000, 2)->>'status' = 'confirmed', 'cancelled slot is released for rebooking');
COMMIT;
\echo 'ok T6 cancellation deduction/refund computed server-side, tampered amounts rejected, idempotent, slot released'

-- ---------------------------------------------------------------- T7 refund settlement and duplicate prevention
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.hms_v4_claim_requested_refund(hms_test.get('near_refund')::uuid);
  PERFORM hms_test.ok((r->>'amount')::bigint = 40000, 'claimed partial refund amount');
  PERFORM hms_test.ok(public.hms_v4_claim_requested_refund(hms_test.get('near_refund')::uuid) IS NULL, 'refund can be claimed only once');
  -- Provider result must match the persisted amount.
  PERFORM hms_test.expect_error(format('SELECT public.hms_apply_refund(%L,%L,%L,50000,%L)', hms_test.get('near_refund'), 'rfnd_TEST1', 'pay_TEST2', 'processed'), 'REFUND_MISMATCH');
  PERFORM public.hms_apply_refund(hms_test.get('near_refund')::uuid, 'rfnd_TEST1', 'pay_TEST2', 40000, 'processed');
  PERFORM public.hms_apply_refund(hms_test.get('near_refund')::uuid, 'rfnd_TEST1', 'pay_TEST2', 40000, 'processed');
  PERFORM hms_test.expect_error(format('SELECT public.hms_apply_refund(%L,%L,%L,40000,%L)', hms_test.get('near_refund'), 'rfnd_OTHER', 'pay_TEST2', 'processed'), 'REFUND_MISMATCH');
END $$;
COMMIT;
DO $$ BEGIN
  PERFORM hms_test.ok((SELECT status FROM hms.payments WHERE provider_payment_id = 'pay_TEST2') = 'partially_refunded', 'payment marked partially refunded');
  PERFORM hms_test.ok((SELECT status FROM hms.refunds WHERE id = hms_test.get('near_refund')::uuid) = 'processed', 'refund processed');
END $$;
SELECT hms_test.put('pay2_id', id::text) FROM hms.payments WHERE provider_payment_id = 'pay_TEST2';
-- Admin full-refund path cannot be used to replace the policy (partial) amount with a full refund.
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000001', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.expect_error(format('SELECT public.hms_refund_claim(%L,%L)', hms_test.get('pay2_id'), 'cancelled_visit'), 'REFUND_REVIEW');
COMMIT;
\echo 'ok T7 refund claimed once, provider mismatch rejected, settlement idempotent'

-- ---------------------------------------------------------------- T8 role separation
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000003', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok(public.hms_staff_context('test-hospital','MAIN') IS NOT NULL, 'receptionist context with MFA');
SELECT hms_test.ok(jsonb_typeof(public.hms_staff_appointments(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, NULL)) = 'array', 'receptionist reads appointments');
SELECT hms_test.expect_error(format('SELECT public.hms_refund_candidates(%L,%L)', hms_test.get('org'), hms_test.get('branch')), 'FORBIDDEN');
SELECT hms_test.expect_error(format('SELECT public.hms_v4_policy_set(%L,%L,0,24,2)', hms_test.get('org'), hms_test.get('branch')), 'FORBIDDEN');
SELECT hms_test.expect_error(format('SELECT public.hms_v3_roles(%L,%L,%L,ARRAY[''super_admin''])', hms_test.get('org'), hms_test.get('branch'), hms_test.get('reception_member')), 'FORBIDDEN');
SELECT hms_test.expect_error(format('SELECT public.hms_admin_doctor(%L,%L,%L,1,true)', hms_test.get('org'), hms_test.get('branch'), hms_test.get('doctor')), 'FORBIDDEN');
SELECT hms_test.expect_error('SELECT count(*) FROM hms.patients', 'permission denied%');
SELECT hms_test.expect_error('SELECT count(*) FROM hms.audit_logs', 'permission denied%');
COMMIT;
\echo 'ok T8 receptionist cannot approve refunds, change policy/fees/roles or read tables directly'

-- ---------------------------------------------------------------- T9 audit trail
DO $$ BEGIN
  PERFORM hms_test.ok((SELECT count(*) FROM hms.audit_logs WHERE action = 'appointment.create') >= 3, 'appointment creation audited');
  PERFORM hms_test.ok(EXISTS (SELECT 1 FROM hms.audit_logs WHERE action = 'appointment.self_cancel.policy'), 'self-cancellation audited');
  PERFORM hms_test.ok(EXISTS (SELECT 1 FROM hms.audit_logs WHERE action = 'booking.cancel_policy.update'), 'policy change audited');
END $$;
\echo 'ok T9 sensitive actions recorded in audit log'
