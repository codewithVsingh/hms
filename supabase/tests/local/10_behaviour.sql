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
SELECT hms_test.expect_error($$SELECT public.hms_v7_book_self('test-hospital','MAIN',gen_random_uuid(),'X Y','hospital',gen_random_uuid(),'v1',true,0,1, DATE '1980-05-05')$$, 'permission denied%');
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
SELECT hms_test.expect_error(format('SELECT public.hms_v7_book_self(%L,%L,%L,%L,%L,gen_random_uuid(),%L,true,50000,2,''1980-05-05'')', 'test-hospital','MAIN', hms_test.get('held_slot'), 'Unverified User', 'online', 'v1'), 'PHONE_VERIFICATION_REQUIRED');
COMMIT;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000a', 'aal1');
SET LOCAL ROLE authenticated;
-- Stale policy version and tampered fee are rejected by the server.
SELECT hms_test.expect_error(format('SELECT public.hms_v7_book_self(%L,%L,%L,%L,%L,gen_random_uuid(),%L,true,50000,1,''1980-05-05'')', 'test-hospital','MAIN', hms_test.get('held_slot'), 'Patient Alpha', 'online', 'v1'), 'POLICY_CHANGED');
SELECT hms_test.expect_error(format('SELECT public.hms_v7_book_self(%L,%L,%L,%L,%L,gen_random_uuid(),%L,true,100,2,''1980-05-05'')', 'test-hospital','MAIN', hms_test.get('held_slot'), 'Patient Alpha', 'online', 'v1'), 'FEE_CHANGED');
SELECT hms_test.put('held_appt', (public.hms_v7_book_self('test-hospital','MAIN', hms_test.get('held_slot')::uuid, 'Patient Alpha', 'online', hms_test.get('req1')::uuid, 'v1', true, 50000, 2, DATE '1980-05-05')->>'id'));
-- Retrying the same request (double click / network retry) returns the same booking.
SELECT hms_test.ok(public.hms_v7_book_self('test-hospital','MAIN', hms_test.get('held_slot')::uuid, 'Patient Alpha', 'online', hms_test.get('req1')::uuid, 'v1', true, 50000, 2, DATE '1980-05-05')->>'id' = hms_test.get('held_appt'), 'idempotent retry returns same booking');
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
SELECT hms_test.expect_error(format('SELECT public.hms_v7_book_self(%L,%L,%L,%L,%L,gen_random_uuid(),%L,true,50000,2,''1980-05-05'')', 'test-hospital','MAIN', hms_test.get('held_slot'), 'Patient Beta', 'online', 'v1'), 'SLOT_UNAVAILABLE');
COMMIT;
\echo 'ok T3 phone verification, policy/fee tamper rejection, idempotent retry, held slot not double-booked'

-- ---------------------------------------------------------------- T4 payment capture (server/service role)
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000a', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.put('far_appt', (public.hms_v7_book_self('test-hospital','MAIN', hms_test.get('far_slot')::uuid, 'Patient Alpha', 'online', gen_random_uuid(), 'v1', true, 50000, 2, DATE '1980-05-05')->>'id'));
SELECT hms_test.put('near_appt', (public.hms_v7_book_self('test-hospital','MAIN', hms_test.get('near_slot')::uuid, 'Patient Alpha', 'online', gen_random_uuid(), 'v1', true, 50000, 2, DATE '1980-05-05')->>'id'));
-- Fourth active future booking for the same account is refused.
SELECT hms_test.expect_error(format('SELECT public.hms_v7_book_self(%L,%L,%L,%L,%L,gen_random_uuid(),%L,true,50000,2,''1980-05-05'')', 'test-hospital','MAIN', hms_test.get('limit_slot'), 'Patient Alpha', 'online', 'v1'), 'BOOKING_LIMIT');
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
SELECT hms_test.ok(public.hms_v7_book_self('test-hospital','MAIN', hms_test.get('near_slot')::uuid, 'Patient Beta', 'hospital', gen_random_uuid(), 'v1', true, 50000, 2, DATE '1980-05-05')->>'status' = 'confirmed', 'cancelled slot is released for rebooking');
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

-- ---------------------------------------------------------------- T11 references and audit immutability (migration 019)
DO $$
DECLARE bad int; total int; distinct_refs int;
BEGIN
  SELECT count(*), count(DISTINCT reference),
         count(*) FILTER (WHERE reference !~ '^BK-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$')
    INTO total, distinct_refs, bad FROM hms.appointments;
  PERFORM hms_test.ok(total >= 4 AND bad = 0, format('%s of %s references use the unambiguous random format', total - bad, total));
  PERFORM hms_test.ok(distinct_refs = total, 'references are unique');
  PERFORM hms_test.ok(NOT EXISTS (SELECT 1 FROM hms.appointments WHERE reference ~ '^BK-0{3}'), 'no sequential zero-padded references');
  PERFORM hms_test.ok((SELECT count(DISTINCT hms_private.random_reference(7)) FROM generate_series(1, 2000)) = 2000, '2000 generated references are distinct');
  -- Even the table owner cannot rewrite or delete audit history through normal statements.
  PERFORM hms_test.expect_error('UPDATE hms.audit_logs SET result = ''tampered''', 'AUDIT_LOG_IMMUTABLE');
  PERFORM hms_test.expect_error('DELETE FROM hms.audit_logs', 'AUDIT_LOG_IMMUTABLE');
  PERFORM hms_test.expect_error('TRUNCATE hms.audit_logs', 'AUDIT_LOG_IMMUTABLE');
END $$;
\echo 'ok T11 random unambiguous booking references; audit log is append-only'

-- ---------------------------------------------------------------- T12 staff patient search (migration 020)
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000003', 'aal2');
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.hms_staff_patients(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, '+91 90000-00001');
  PERFORM hms_test.ok(jsonb_array_length(r) = 1 AND r->0->>'name' = 'Patient Alpha', 'search by mobile number (any formatting): ' || r::text);
  r := public.hms_staff_patients(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, lower(hms_test.get('far_ref')));
  PERFORM hms_test.ok(jsonb_array_length(r) = 1 AND r->0->>'name' = 'Patient Alpha', 'search by booking reference');
  r := public.hms_staff_patients(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, 'beta');
  PERFORM hms_test.ok(jsonb_array_length(r) = 1 AND r->0->>'name' = 'Patient Beta', 'search by name');
  r := public.hms_staff_patients(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, '0000000000');
  PERFORM hms_test.ok(jsonb_array_length(r) = 0, 'unknown number finds nothing');
  PERFORM hms_test.expect_error(format('SELECT public.hms_staff_patients(%L,%L,%L)', hms_test.get('org'), hms_test.get('branch'), repeat('x', 101)), 'INVALID_REQUEST');
END $$;
COMMIT;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000a', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.expect_error(format('SELECT public.hms_staff_patients(%L,%L,%L)', hms_test.get('org'), hms_test.get('branch'), 'Alpha'), 'FORBIDDEN');
COMMIT;
DO $$ BEGIN
  PERFORM hms_test.ok((SELECT count(*) FROM hms.audit_logs WHERE action = 'patient.search' AND actor_user_id = 'a0000000-0000-4000-8000-000000000003') = 4, 'each search audited with the actor');
  PERFORM hms_test.ok(NOT EXISTS (SELECT 1 FROM hms.audit_logs WHERE to_jsonb(audit_logs)::text ILIKE '%alpha%' OR to_jsonb(audit_logs)::text LIKE '%9000000001%'), 'search text is not stored in the audit log');
END $$;
\echo 'ok T12 staff search by phone, reference and name; patients cannot search; searches audited without search text'

-- ---------------------------------------------------------------- T13 doctor unavailability (migration 021)
-- Bookings in the window: far_appt (Alpha, paid online), Beta's booking on near_slot (pays at desk),
-- held_appt (Alpha, held, unpaid). The window ends before the slots T10 uses (> 9 days ahead).
SELECT hms_test.put('beta_near', id::text) FROM hms.appointments WHERE slot_id = hms_test.get('near_slot')::uuid AND status = 'confirmed';
SELECT hms_test.put('leave_start', (now() + interval '1 hour')::text);
SELECT hms_test.put('leave_end', (now() + interval '8 days')::text);
SELECT hms_test.put('free_in_window', s.id::text) FROM hms.appointment_slots s
  WHERE s.doctor_id = hms_test.get('doctor')::uuid AND s.starts_at > now() + interval '2 days' AND s.starts_at < now() + interval '4 days'
    AND NOT EXISTS (SELECT 1 FROM hms.appointments a WHERE a.slot_id = s.id) ORDER BY s.starts_at LIMIT 1;
BEGIN; -- reception collects the desk payment for Beta
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000003', 'aal2');
SET LOCAL ROLE authenticated;
SELECT public.hms_collect_offline(hms_test.get('beta_near')::uuid, 'cash');
-- Reception (no settings.manage, not the doctor) cannot add leave.
SELECT hms_test.expect_error(format('SELECT public.hms_v5_leave_add(%L,%L,%L,%L,%L,%L)', hms_test.get('org'), hms_test.get('branch'), hms_test.get('doctor'), hms_test.get('leave_start'), hms_test.get('leave_end'), 'unwell'), 'FORBIDDEN');
COMMIT;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000001', 'aal2');
SET LOCAL ROLE authenticated;
-- The original function still refuses (unchanged behaviour); the new one records the leave.
SELECT hms_test.expect_error(format('SELECT public.hms_v3_leave_add(%L,%L,%L,%L,%L)', hms_test.get('org'), hms_test.get('branch'), hms_test.get('doctor'), hms_test.get('leave_start'), hms_test.get('leave_end')), 'LEAVE_HAS_BOOKINGS');
SELECT hms_test.expect_error(format('SELECT public.hms_v5_leave_add(%L,%L,%L,%L,%L,%L)', hms_test.get('org'), hms_test.get('branch'), hms_test.get('doctor'), hms_test.get('leave_start'), hms_test.get('leave_end'), 'holiday-ish'), 'INVALID_REQUEST');
SELECT hms_test.ok((public.hms_v5_leave_add(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, hms_test.get('doctor')::uuid, hms_test.get('leave_start')::timestamptz, hms_test.get('leave_end')::timestamptz, 'unwell')->>'affected')::int = 3, 'leave recorded and 3 affected bookings reported');
COMMIT;
BEGIN; -- the leave blocks new bookings immediately
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000b', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.expect_error(format('SELECT public.hms_v7_book_self(%L,%L,%L,%L,%L,gen_random_uuid(),%L,true,50000,2,''1980-05-05'')', 'test-hospital','MAIN', hms_test.get('free_in_window'), 'Patient Beta', 'hospital', 'v1'), 'SLOT_UNAVAILABLE');
SELECT hms_test.expect_error(format('SELECT public.hms_v5_affected_bookings(%L,%L)', hms_test.get('org'), hms_test.get('branch')), 'FORBIDDEN');
SELECT hms_test.expect_error(format('SELECT public.hms_v5_hospital_cancel(%L,%L)', hms_test.get('far_appt'), 'doctor_unavailable'), 'FORBIDDEN');
COMMIT;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000003', 'aal2');
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb; x jsonb;
BEGIN
  r := public.hms_v5_affected_bookings(hms_test.get('org')::uuid, hms_test.get('branch')::uuid);
  PERFORM hms_test.ok(jsonb_array_length(r) = 3, 'reception sees the 3 affected bookings: ' || r::text);
  PERFORM hms_test.ok((SELECT bool_and(e->>'leaveReason' = 'unwell' AND e->>'phone' LIKE '+91%') FROM jsonb_array_elements(r) e), 'affected rows carry leave reason and phone for call-back');
  PERFORM hms_test.ok((SELECT e->>'paymentMethod' FROM jsonb_array_elements(r) e WHERE e->>'id' = hms_test.get('beta_near')) = 'cash', 'desk payment shown');
  PERFORM hms_test.expect_error(format('SELECT public.hms_v5_hospital_cancel(%L,%L)', hms_test.get('far_appt'), 'because'), 'INVALID_REQUEST');
  -- Online-paid booking: full refund requested (no cancellation fee even inside 24h policy window).
  x := public.hms_v5_hospital_cancel(hms_test.get('far_appt')::uuid, 'doctor_unavailable');
  PERFORM hms_test.ok(x->>'refundMode' = 'online' AND (x->>'refundPaise')::bigint = 50000, 'online booking cancelled with full refund: ' || x::text);
  PERFORM hms_test.put('far_refund', x->>'refundId');
  PERFORM hms_test.ok((public.hms_v5_hospital_cancel(hms_test.get('far_appt')::uuid, 'doctor_unavailable')->>'repeat')::boolean, 'repeat cancel is idempotent');
  -- Desk-paid booking: refund owed at the desk.
  x := public.hms_v5_hospital_cancel(hms_test.get('beta_near')::uuid, 'doctor_unavailable');
  PERFORM hms_test.ok(x->>'refundMode' = 'desk' AND (x->>'refundPaise')::bigint = 50000, 'desk booking cancelled, refund due at desk: ' || x::text);
  PERFORM hms_test.put('desk_refund', x->>'refundId');
  -- Held, unpaid booking: nothing to refund.
  x := public.hms_v5_hospital_cancel(hms_test.get('held_appt')::uuid, 'doctor_unavailable');
  PERFORM hms_test.ok(x->>'refundMode' = 'none' AND (x->>'refundPaise')::bigint = 0, 'unpaid hold cancelled without refund');
  PERFORM hms_test.ok(jsonb_array_length(public.hms_v5_affected_bookings(hms_test.get('org')::uuid, hms_test.get('branch')::uuid)) = 0, 'affected list is empty once resolved');
  -- Billing settles the desk refund.
  r := public.hms_v5_desk_refunds(hms_test.get('org')::uuid, hms_test.get('branch')::uuid);
  PERFORM hms_test.ok(jsonb_array_length(r) = 1 AND r->0->>'id' = hms_test.get('desk_refund'), 'desk refund listed for billing');
  PERFORM hms_test.expect_error(format('SELECT public.hms_v5_record_desk_refund(%L,%L)', hms_test.get('far_refund'), 'cash'), 'FORBIDDEN');
  PERFORM hms_test.ok(public.hms_v5_record_desk_refund(hms_test.get('desk_refund')::uuid, 'cash')->>'status' = 'processed', 'desk refund recorded');
  PERFORM hms_test.ok((public.hms_v5_record_desk_refund(hms_test.get('desk_refund')::uuid, 'cash')->>'repeat')::boolean, 'recording twice is idempotent');
  PERFORM hms_test.ok(jsonb_array_length(public.hms_v5_desk_refunds(hms_test.get('org')::uuid, hms_test.get('branch')::uuid)) = 0, 'desk list cleared');
END $$;
COMMIT;
BEGIN; -- server paths: online refund is claimable, desk refund never goes to the provider
SET LOCAL ROLE service_role;
SELECT hms_test.ok(public.hms_v4_requested_refunds('test-hospital','MAIN') @> to_jsonb(hms_test.get('far_refund')), 'online hospital refund queued for provider');
SELECT hms_test.ok(public.hms_v4_claim_requested_refund(hms_test.get('desk_refund')::uuid) IS NULL, 'desk refund is never sent to Razorpay');
COMMIT;
BEGIN; -- the patient sees the outcome on Manage booking
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000a', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok((SELECT (q->>'cancelled')::boolean AND (q->>'deductionPaise')::bigint = 0 AND (q->>'refundPaise')::bigint = 50000 AND q->>'refundStatus' = 'requested'
  FROM (SELECT public.hms_v4_cancel_quote(hms_test.get('far_appt')::uuid) q) z), 'patient sees full refund requested');
COMMIT;
DO $$ BEGIN
  PERFORM hms_test.ok((SELECT status FROM hms.payments WHERE id = (SELECT payment_id FROM hms.refunds WHERE id = hms_test.get('desk_refund')::uuid)) = 'refunded', 'desk payment marked refunded');
  PERFORM hms_test.ok((SELECT settled_method FROM hms.refunds WHERE id = hms_test.get('desk_refund')::uuid) = 'cash', 'desk refund method recorded');
  PERFORM hms_test.ok((SELECT count(*) FROM hms.booking_cancellations WHERE initiated_by = 'hospital' AND reason_code = 'doctor_unavailable') = 3, 'hospital cancellations recorded with reason');
  PERFORM hms_test.ok((SELECT count(*) FROM hms.appointment_status_history WHERE reason_code = 'doctor_unavailable') = 3, 'status history carries reason');
  PERFORM hms_test.ok((SELECT count(*) FROM hms.audit_logs WHERE action = 'appointment.hospital_cancel') = 3 AND EXISTS (SELECT 1 FROM hms.audit_logs WHERE action = 'refund.desk_settled'), 'hospital cancellations and desk refund audited');
  PERFORM hms_test.ok((SELECT reason_code FROM hms.doctor_leaves ORDER BY created_at DESC LIMIT 1) = 'unwell', 'leave reason stored');
END $$;
SELECT hms_test.put('far_pay_id', id::text) FROM hms.payments WHERE provider_payment_id = 'pay_TEST1';
BEGIN; -- admin approves the online hospital refund (full amount, never more)
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000001', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok((public.hms_refund_claim(hms_test.get('far_pay_id')::uuid, 'cancelled_visit')->>'amount')::bigint = 50000, 'admin approval uses the stored full amount');
SELECT hms_test.expect_error(format('SELECT public.hms_refund_claim(%L,%L)', hms_test.get('far_pay_id'), 'cancelled_visit'), 'REFUND_REVIEW');
COMMIT;
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.hms_apply_refund(hms_test.get('far_refund')::uuid, 'rfnd_TEST2', 'pay_TEST1', 50000, 'processed');
COMMIT;
DO $$ BEGIN
  PERFORM hms_test.ok((SELECT status FROM hms.payments WHERE provider_payment_id = 'pay_TEST1') = 'refunded', 'online payment fully refunded after provider confirmation');
END $$;
\echo 'ok T13 doctor unavailable: leave recorded despite bookings, blocks new bookings, affected list, hospital cancel with full refund (online/desk/none), desk refund settlement'

-- ---------------------------------------------------------------- T14 prescription corrections (migration 022)
-- Fixture: a second doctor in the same branch (synthetic), an SMS opt-in for Patient Alpha, and a
-- consultation for Alpha on a slot after the T13 leave (and before the slots T10 uses).
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('a0000000-0000-4000-8000-000000000004', 'doctor2@example.test', now());
DO $$
DECLARE m uuid; d uuid;
BEGIN
  INSERT INTO hms.profiles (user_id, display_name) VALUES ('a0000000-0000-4000-8000-000000000004', 'Dr Second Doctor');
  INSERT INTO hms.memberships (organization_id, user_id) VALUES (hms_test.get('org')::uuid, 'a0000000-0000-4000-8000-000000000004') RETURNING id INTO m;
  INSERT INTO hms.membership_branches VALUES (hms_test.get('org')::uuid, m, hms_test.get('branch')::uuid);
  INSERT INTO hms.user_roles VALUES (hms_test.get('org')::uuid, m, hms_test.get('branch')::uuid, 'doctor');
  INSERT INTO hms.doctors (organization_id, membership_id, department_id, public_slug, display_name, specialty, registration_number, fee_paise, published)
    SELECT hms_test.get('org')::uuid, m, department_id, 'doctor-2', 'Dr Second Doctor', specialty, 'TEST-REG-2', 50000, false
    FROM hms.doctors WHERE id = hms_test.get('doctor')::uuid RETURNING id INTO d;
  INSERT INTO hms.doctor_branches (organization_id, doctor_id, branch_id) VALUES (hms_test.get('org')::uuid, d, hms_test.get('branch')::uuid);
  INSERT INTO hms.notification_preferences (organization_id, patient_id, channel, enabled)
    SELECT hms_test.get('org')::uuid, po.patient_id, 'sms', true FROM hms.patient_owners po WHERE po.user_id = 'a0000000-0000-4000-8000-00000000000a';
END $$;
SELECT hms_test.put('rx_slot', s.id::text) FROM hms.appointment_slots s
  WHERE s.doctor_id = hms_test.get('doctor')::uuid AND s.starts_at > now() + interval '8 days 1 hour' AND s.starts_at < now() + interval '9 days'
    AND NOT EXISTS (SELECT 1 FROM hms.appointments a WHERE a.slot_id = s.id) ORDER BY s.starts_at LIMIT 1;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000a', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.put('rx_appt', public.hms_v7_book_self('test-hospital','MAIN', hms_test.get('rx_slot')::uuid, 'Patient Alpha', 'hospital', gen_random_uuid(), 'v1', true, 50000, 2, DATE '1980-05-05')->>'id');
COMMIT;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000003', 'aal2');
SET LOCAL ROLE authenticated;
SELECT public.hms_change_status(hms_test.get('rx_appt')::uuid, 'checked_in');
COMMIT;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000002', 'aal2');
SET LOCAL ROLE authenticated;
SELECT public.hms_change_status(hms_test.get('rx_appt')::uuid, 'in_consultation');
SELECT hms_test.put('rx1', public.hms_v3_issue_rx(hms_test.get('rx_appt')::uuid,
  '[{"medicine":"Paracetamol 500 mg","dose":"1 tablet","frequency":"Twice daily","duration":"3 days","instructions":"After food"}]'::jsonb,
  NULL, true, true)->>'id');
COMMIT;
BEGIN; -- reception hands over a printed copy of version 1
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000003', 'aal2');
SET LOCAL ROLE authenticated;
SELECT public.hms_v4_rx_handover(hms_test.get('rx1')::uuid, 'printed');
-- Reception cannot amend.
SELECT hms_test.expect_error(format('SELECT public.hms_v6_rx_amend(%L,%L::jsonb,NULL,%L,NULL,true)', hms_test.get('rx1'), '[{"medicine":"X","dose":"1","frequency":"1","duration":"1"}]', 'typo'), 'FORBIDDEN');
COMMIT;
BEGIN; -- another doctor cannot amend someone else's prescription
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000004', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.expect_error(format('SELECT public.hms_v6_rx_amend(%L,%L::jsonb,NULL,%L,NULL,true)', hms_test.get('rx1'), '[{"medicine":"X","dose":"1","frequency":"1","duration":"1"}]', 'typo'), 'FORBIDDEN');
COMMIT;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000002', 'aal2');
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb; items constant text := '[{"medicine":"Paracetamol 500 mg","dose":"1 tablet","frequency":"Three times daily","duration":"3 days","instructions":"After food"}]';
BEGIN
  PERFORM hms_test.expect_error(format('SELECT public.hms_v6_rx_amend(%L,%L::jsonb,NULL,%L,NULL,true)', hms_test.get('rx1'), items, 'other'), 'INVALID_REQUEST');
  PERFORM hms_test.expect_error(format('SELECT public.hms_v6_rx_amend(%L,%L::jsonb,NULL,%L,NULL,false)', hms_test.get('rx1'), items, 'dose_change'), 'INVALID_REQUEST');
  r := public.hms_v6_rx_amend(hms_test.get('rx1')::uuid, items::jsonb, NULL, 'dose_change', 'Frequency corrected', true);
  PERFORM hms_test.ok((r->>'version')::int = 2 AND (r->'replaces'->>'version')::int = 1 AND (r->>'paperCopyToRecall')::boolean AND (r->>'released')::boolean,
    'amendment creates version 2, keeps portal release and flags the printed copy: ' || r::text);
  PERFORM hms_test.put('rx2', r->>'id');
  PERFORM hms_test.expect_error(format('SELECT public.hms_v6_rx_amend(%L,%L::jsonb,NULL,%L,NULL,true)', hms_test.get('rx1'), items, 'typo'), 'NOT_CURRENT_VERSION');
END $$;
COMMIT;
DO $$ BEGIN
  PERFORM hms_test.ok((SELECT status FROM hms.prescriptions WHERE id = hms_test.get('rx1')::uuid) = 'superseded', 'version 1 superseded, not deleted');
  PERFORM hms_test.ok((SELECT count(*) FROM hms.prescription_items WHERE prescription_id = hms_test.get('rx1')::uuid) = 1, 'version 1 items preserved');
  PERFORM hms_test.ok(EXISTS (SELECT 1 FROM hms.notification_jobs WHERE template_key = 'prescription_updated'), 'patient notified of the update');
  PERFORM hms_test.expect_error(format('UPDATE hms.prescriptions SET status = %L WHERE id = %L', 'signed', hms_test.get('rx1')), 'duplicate key%');
END $$;
BEGIN; -- the patient sees only the current version, marked as an update
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000a', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok((SELECT jsonb_array_length(x) = 1 AND (x->0->>'version')::int = 2 AND (x->0->'replaces'->>'version')::int = 1 AND NOT (x->0 ? 'mine')
  FROM (SELECT public.hms_v3_patient_records('test-hospital')->'prescriptions' x) z), 'patient sees only version 2');
COMMIT;
SELECT hms_test.put('alpha_mrn', p.mrn) FROM hms.patients p JOIN hms.patient_owners po ON po.patient_id = p.id WHERE po.user_id = 'a0000000-0000-4000-8000-00000000000a';
BEGIN; -- reception recalls the printed version 1
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000003', 'aal2');
SET LOCAL ROLE authenticated;
DO $$
DECLARE reg jsonb;
BEGIN
  reg := public.hms_v4_rx_register(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, hms_test.get('alpha_mrn'));
  PERFORM hms_test.ok(jsonb_array_length(reg->'recall') = 1 AND reg->'recall'->0->>'id' = hms_test.get('rx1'), 'register lists the printed version 1 for recall');
  PERFORM hms_test.ok((reg->'prescriptions'->0->>'amended')::boolean, 'register marks the current version as amended');
  PERFORM hms_test.ok(public.hms_v6_rx_recall_ack(hms_test.get('rx1')::uuid)->>'status' = 'recalled', 'recall recorded');
  PERFORM hms_test.ok((public.hms_v6_rx_recall_ack(hms_test.get('rx1')::uuid)->>'repeat')::boolean, 'recall is idempotent');
  PERFORM hms_test.ok(jsonb_array_length(public.hms_v4_rx_register(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, hms_test.get('alpha_mrn'))->'recall') = 0, 'recall list cleared');
END $$;
COMMIT;
-- Amendment window: pretend version 1 was issued 73 hours ago (window is 72 hours from FIRST issue).
UPDATE hms.prescriptions SET signed_at = now() - interval '73 hours' WHERE id = hms_test.get('rx1')::uuid;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000002', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.expect_error(format('SELECT public.hms_v6_rx_amend(%L,%L::jsonb,NULL,%L,NULL,true)', hms_test.get('rx2'), '[{"medicine":"X","dose":"1","frequency":"1","duration":"1"}]', 'typo'), 'AMEND_WINDOW_CLOSED');
-- Withdrawal: no time limit; requested by the issuing doctor.
SELECT hms_test.expect_error(format('SELECT public.hms_v6_rx_withdraw_request(%L,%L,NULL)', hms_test.get('rx2'), 'other'), 'INVALID_REQUEST');
SELECT hms_test.put('wd1', public.hms_v6_rx_withdraw_request(hms_test.get('rx2')::uuid, 'wrong_patient', 'Issued to the wrong patient record')->>'withdrawalId');
SELECT hms_test.expect_error(format('SELECT public.hms_v6_rx_withdraw_request(%L,%L,NULL)', hms_test.get('rx2'), 'duplicate'), 'WITHDRAWAL_PENDING');
-- The requester cannot confirm their own withdrawal.
SELECT hms_test.expect_error(format('SELECT public.hms_v6_rx_withdraw_decide(%L,true,NULL)', hms_test.get('wd1')), 'SECOND_PERSON_REQUIRED');
COMMIT;
BEGIN; -- hidden from the patient while pending
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000a', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok(jsonb_array_length(public.hms_v3_patient_records('test-hospital')->'prescriptions') = 0, 'pending withdrawal hides the prescription from the patient');
COMMIT;
BEGIN; -- reception cannot see or decide withdrawals
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000003', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.expect_error(format('SELECT public.hms_v6_rx_withdrawals(%L,%L)', hms_test.get('org'), hms_test.get('branch')), 'FORBIDDEN');
SELECT hms_test.expect_error(format('SELECT public.hms_v6_rx_withdraw_decide(%L,true,NULL)', hms_test.get('wd1')), 'FORBIDDEN');
SELECT hms_test.expect_error(format('SELECT public.hms_v4_rx_handover(%L,%L)', hms_test.get('rx2'), 'printed'), 'WITHDRAWAL_PENDING');
COMMIT;
BEGIN; -- admin sees the request without medicines, rejects with a reason
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000001', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok((SELECT jsonb_array_length(x) = 1 AND x->0->'items' = 'null'::jsonb AND x->0->>'reason' = 'wrong_patient'
  FROM (SELECT public.hms_v6_rx_withdrawals(hms_test.get('org')::uuid, hms_test.get('branch')::uuid) x) z), 'admin sees request without clinical details');
SELECT hms_test.expect_error(format('SELECT public.hms_v6_rx_withdraw_decide(%L,false,NULL)', hms_test.get('wd1')), 'INVALID_REQUEST');
SELECT hms_test.ok(public.hms_v6_rx_withdraw_decide(hms_test.get('wd1')::uuid, false, 'Checked: correct patient')->>'status' = 'rejected', 'admin rejects');
COMMIT;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000a', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok(jsonb_array_length(public.hms_v3_patient_records('test-hospital')->'prescriptions') = 1, 'rejected withdrawal makes it visible again');
COMMIT;
BEGIN; -- request, cancel by requester, request again
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000002', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok(public.hms_v6_rx_withdraw_cancel((public.hms_v6_rx_withdraw_request(hms_test.get('rx2')::uuid, 'issued_in_error', NULL)->>'withdrawalId')::uuid)->>'status' = 'cancelled', 'requester can cancel a pending withdrawal');
SELECT hms_test.put('wd3', public.hms_v6_rx_withdraw_request(hms_test.get('rx2')::uuid, 'wrong_patient', 'Wrong patient selected')->>'withdrawalId');
COMMIT;
BEGIN; -- another doctor sees medicines and confirms
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000004', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok((SELECT jsonb_array_length(x->0->'items') = 1 AND NOT (x->0->>'mine')::boolean
  FROM (SELECT public.hms_v6_rx_withdrawals(hms_test.get('org')::uuid, hms_test.get('branch')::uuid) x) z), 'second doctor sees the medicines to judge the request');
SELECT hms_test.expect_error(format('SELECT public.hms_v6_rx_withdraw_cancel(%L)', hms_test.get('wd3')), 'FORBIDDEN');
SELECT hms_test.ok(public.hms_v6_rx_withdraw_decide(hms_test.get('wd3')::uuid, true, NULL)->>'status' = 'approved', 'second doctor approves');
SELECT hms_test.expect_error(format('SELECT public.hms_v6_rx_withdraw_decide(%L,true,NULL)', hms_test.get('wd3')), 'INVALID_STATUS');
COMMIT;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000a', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok(jsonb_array_length(public.hms_v3_patient_records('test-hospital')->'prescriptions') = 0, 'withdrawn prescription hidden from patient');
COMMIT;
BEGIN; -- the issuing doctor sees the full history
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000002', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok((SELECT jsonb_array_length(h) = 2 AND h->0->>'status' = 'void' AND h->0->>'amendReason' = 'dose_change' AND h->0->>'amendNote' = 'Frequency corrected'
    AND jsonb_array_length(h->0->'withdrawals') = 3 AND h->1->>'status' = 'superseded'
  FROM (SELECT public.hms_v6_rx_history(hms_test.get('rx2')::uuid) h) z), 'history shows both versions, reasons and all withdrawal decisions');
COMMIT;
BEGIN; -- patients cannot read prescription history
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000a', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.expect_error(format('SELECT public.hms_v6_rx_history(%L)', hms_test.get('rx2')), 'FORBIDDEN');
COMMIT;
DO $$ BEGIN
  PERFORM hms_test.ok(EXISTS (SELECT 1 FROM hms.notification_jobs WHERE template_key = 'prescription_withdrawn'), 'patient notified of withdrawal');
  PERFORM hms_test.ok((SELECT count(*) FROM hms.prescriptions WHERE encounter_id = (SELECT encounter_id FROM hms.prescriptions WHERE id = hms_test.get('rx2')::uuid)) = 2, 'nothing deleted');
  PERFORM hms_test.ok((SELECT count(DISTINCT action) FROM hms.audit_logs WHERE action IN ('prescription.amended', 'prescription.withdraw.requested', 'prescription.withdraw.cancelled',
    'prescription.withdraw.rejected', 'prescription.withdraw.approved', 'prescription.paper.recalled', 'prescription.history.read')) = 7, 'every correction step audited');
END $$;
\echo 'ok T14 prescription corrections: issuer-only amend in 72h window, versions kept, patient sees current only, paper recall, two-person withdrawal, history, notifications, audit'

-- ---------------------------------------------------------------- T15 duplicate patients and merge (migration 023)
INSERT INTO auth.users (id, phone, phone_confirmed_at) VALUES ('a0000000-0000-4000-8000-00000000000e', '+919800000001', now());
SELECT hms_test.put('t15_slot', s.id::text) FROM hms.appointment_slots s
  WHERE s.doctor_id = hms_test.get('doctor')::uuid AND s.starts_at > now() + interval '8 days 1 hour' AND s.starts_at < now() + interval '9 days'
    AND NOT EXISTS (SELECT 1 FROM hms.appointments a WHERE a.slot_id = s.id) ORDER BY s.starts_at LIMIT 1;
BEGIN; -- reception registers a walk-in, then checks look-alikes
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000003', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.put('walkin', public.hms_v7_register(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, 'Smt. Sunitha Sharma', DATE '1975-03-04', '+919800000001', 'female', 'v1', NULL)::text);
DO $$
DECLARE o uuid := hms_test.get('org')::uuid; b uuid := hms_test.get('branch')::uuid; r jsonb;
BEGIN
  r := public.hms_v7_duplicate_check(o, b, 'Sunita Sharma', DATE '1975-03-04', '+91 98000 00001', NULL);
  PERFORM hms_test.ok(jsonb_array_length(r) = 1 AND r->0->>'level' = 'likely' AND r->0->>'phoneLast4' = '0001', 'same mobile + similar name + same DOB = likely: ' || r::text);
  PERFORM hms_test.ok(NOT (r->0 ? 'phone'), 'full mobile number is not shown, only the last 4 digits');
  PERFORM hms_test.ok(jsonb_array_length(public.hms_v7_duplicate_check(o, b, 'Aarav Sharma', DATE '2015-06-01', '+919800000001', NULL)) = 0, 'shared mobile alone is not a match (family member)');
  PERFORM hms_test.ok(public.hms_v7_duplicate_check(o, b, 'Sunita Sharma', NULL, '+919800000001', NULL)->0->>'level' = 'possible', 'same mobile + similar name, no DOB = possible');
  PERFORM hms_test.ok(public.hms_v7_duplicate_check(o, b, 'Sunita Sharma', DATE '1975-04-03', '+919800000001', NULL)->0->>'level' = 'possible', 'day/month swapped DOB = possible');
  PERFORM hms_test.ok(public.hms_v7_duplicate_check(o, b, 'Sharma Sunita', DATE '1975-03-04', '+919811111111', NULL)->0->>'level' = 'possible', 'similar name (any word order) + same DOB, different mobile = possible');
  PERFORM hms_test.ok(jsonb_array_length(public.hms_v7_duplicate_check(o, b, 'Sunita Sharma', DATE '1980-01-01', '+919800000001', NULL)) = 0, 'different known DOB = not a match');
  PERFORM hms_test.ok(jsonb_array_length(public.hms_v7_duplicate_check(o, b, 'Sunita Sharma', DATE '1975-03-04', '+919800000001', 'male')) = 0, 'different gender = not a match');
  -- Registration is refused while look-alikes exist, unless a reason is given.
  PERFORM hms_test.expect_error(format('SELECT public.hms_v7_register(%L,%L,%L,%L::date,%L,NULL,%L,NULL)', o, b, 'Sunita Sharma', '1975-03-04', '+919800000001', 'v1'), 'POSSIBLE_DUPLICATE');
  PERFORM hms_test.ok(public.hms_v7_register(o, b, 'Aarav Sharma', DATE '2015-06-01', '+919800000001', 'male', 'v1', NULL) IS NOT NULL, 'child on the same mobile registers without a warning');
  PERFORM public.hms_v7_register(o, b, 'Ramesh Kumar', DATE '1960-01-01', '+919822222222', 'male', 'v1', NULL);
  PERFORM hms_test.expect_error(format('SELECT public.hms_v7_register(%L,%L,%L,NULL,%L,NULL,%L,%L)', o, b, 'Kumar Ramesh', '+919822222222', 'v1', 'no'), 'INVALID_REQUEST');
  PERFORM hms_test.ok(public.hms_v7_register(o, b, 'Kumar Ramesh', NULL, '+919822222222', 'male', 'v1', 'Father and son share name and phone') IS NOT NULL, 'register anyway with a reason');
END $$;
-- The old registration function is closed to browsers.
SELECT hms_test.expect_error(format('SELECT public.hms_staff_register(%L,%L,%L,NULL,NULL,%L)', hms_test.get('org'), hms_test.get('branch'), 'Bypass Test', 'v1'), 'permission denied%');
COMMIT;
DO $$ BEGIN
  PERFORM hms_test.ok(EXISTS (SELECT 1 FROM hms.patient_duplicate_flags WHERE source = 'registration' AND status = 'dismissed' AND resolution_note = 'Father and son share name and phone'), 'override reason recorded');
  PERFORM hms_test.ok((SELECT mrn FROM hms.patients WHERE id = hms_test.get('walkin')::uuid) ~ '^PT-\d{6,}$', 'walk-in gets a UHID');
END $$;
BEGIN; -- online booking: date of birth required, adult only, new record flagged silently
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000e', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.expect_error(format('SELECT public.hms_v4_book_self(%L,%L,%L,%L,%L,gen_random_uuid(),%L,true,50000,2)', 'test-hospital','MAIN', hms_test.get('t15_slot'), 'Sunita Sharma', 'hospital', 'v1'), 'permission denied%');
SELECT hms_test.expect_error(format('SELECT public.hms_v7_book_self(%L,%L,%L,%L,%L,gen_random_uuid(),%L,true,50000,2,NULL)', 'test-hospital','MAIN', hms_test.get('t15_slot'), 'Sunita Sharma', 'hospital', 'v1'), 'INVALID_REQUEST');
SELECT hms_test.expect_error(format('SELECT public.hms_v7_book_self(%L,%L,%L,%L,%L,gen_random_uuid(),%L,true,50000,2,%L::date)', 'test-hospital','MAIN', hms_test.get('t15_slot'), 'Sunita Sharma', 'hospital', 'v1', current_date - 3650), 'ADULT_REQUIRED');
SELECT hms_test.put('online_appt', public.hms_v7_book_self('test-hospital','MAIN', hms_test.get('t15_slot')::uuid, 'Sunita Sharma', 'hospital', gen_random_uuid(), 'v1', true, 50000, 2, DATE '1975-03-04')->>'id');
COMMIT;
SELECT hms_test.put('online_pat', patient_id::text) FROM hms.appointments WHERE id = hms_test.get('online_appt')::uuid;
SELECT hms_test.put('online_mrn', mrn) FROM hms.patients WHERE id = hms_test.get('online_pat')::uuid;
SELECT hms_test.put('walkin_mrn', mrn) FROM hms.patients WHERE id = hms_test.get('walkin')::uuid;
DO $$ BEGIN
  PERFORM hms_test.ok((SELECT birth_date FROM hms.patients WHERE id = hms_test.get('online_pat')::uuid) = DATE '1975-03-04', 'DOB stored from online booking');
  PERFORM hms_test.ok(EXISTS (SELECT 1 FROM hms.patient_duplicate_flags WHERE patient_id = hms_test.get('online_pat')::uuid AND candidate_id = hms_test.get('walkin')::uuid
    AND level = 'likely' AND source = 'online_booking' AND status = 'open'), 'new online record flagged against the walk-in');
END $$;
BEGIN; -- the visit gets an encounter, to prove clinical records move with the merge
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000003', 'aal2');
SET LOCAL ROLE authenticated;
SELECT public.hms_change_status(hms_test.get('online_appt')::uuid, 'checked_in');
COMMIT;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000002', 'aal2');
SET LOCAL ROLE authenticated;
SELECT public.hms_change_status(hms_test.get('online_appt')::uuid, 'in_consultation');
SELECT hms_test.put('t15_rx', public.hms_v3_issue_rx(hms_test.get('online_appt')::uuid,
  '[{"medicine":"Cetirizine 10 mg","dose":"1 tablet","frequency":"Once daily","duration":"5 days","instructions":""}]'::jsonb, NULL, true, true)->>'id');
-- Doctors cannot see the duplicates queue or propose merges.
SELECT hms_test.expect_error(format('SELECT public.hms_v7_duplicates(%L,%L)', hms_test.get('org'), hms_test.get('branch')), 'FORBIDDEN');
SELECT hms_test.expect_error(format('SELECT public.hms_v7_merge_propose(%L,%L,%L,%L,NULL)', hms_test.get('org'), hms_test.get('branch'), hms_test.get('online_pat'), hms_test.get('walkin')), 'FORBIDDEN');
COMMIT;
BEGIN; -- the patient cannot see the queue
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000e', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.expect_error(format('SELECT public.hms_v7_duplicates(%L,%L)', hms_test.get('org'), hms_test.get('branch')), 'FORBIDDEN');
COMMIT;
SELECT hms_test.put('alpha_pat', patient_id::text) FROM hms.patient_owners WHERE user_id = 'a0000000-0000-4000-8000-00000000000a';
SELECT hms_test.put('beta_pat', patient_id::text) FROM hms.patient_owners WHERE user_id = 'a0000000-0000-4000-8000-00000000000b';
SELECT hms_test.put('ramesh1', id::text) FROM hms.patients WHERE full_name = 'Ramesh Kumar';
SELECT hms_test.put('ramesh2', id::text) FROM hms.patients WHERE full_name = 'Kumar Ramesh';
BEGIN; -- reception reviews and proposes; the first-registered UHID survives
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000003', 'aal2');
SET LOCAL ROLE authenticated;
DO $$
DECLARE o uuid := hms_test.get('org')::uuid; b uuid := hms_test.get('branch')::uuid; q jsonb; p jsonb;
BEGIN
  q := public.hms_v7_duplicates(o, b);
  PERFORM hms_test.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(q) e WHERE e->'patient'->>'id' = hms_test.get('online_pat') AND e->>'level' = 'likely'), 'queue shows the online flag');
  PERFORM hms_test.expect_error(format('SELECT public.hms_v7_merge_propose(%L,%L,%L,%L,NULL)', o, b,
    hms_test.get('alpha_pat'), hms_test.get('beta_pat')), 'BOTH_HAVE_ACCOUNTS');
  p := public.hms_v7_merge_propose(o, b, hms_test.get('online_pat')::uuid, hms_test.get('walkin')::uuid, 'Same person: walk-in, then booked online');
  PERFORM hms_test.ok(p->'survivor'->>'mrn' = hms_test.get('walkin_mrn'), 'older (walk-in) UHID survives');
  PERFORM hms_test.put('merge1', p->>'mergeId');
  PERFORM hms_test.expect_error(format('SELECT public.hms_v7_merge_propose(%L,%L,%L,%L,NULL)', o, b, hms_test.get('walkin'), hms_test.get('online_pat')), 'MERGE_PENDING');
  PERFORM hms_test.expect_error(format('SELECT public.hms_v7_merge_decide(%L,true,%L,NULL,NULL)', hms_test.get('merge1'), 'aadhaar'), 'FORBIDDEN');
END $$;
COMMIT;
BEGIN; -- the administrator: ID check required, rejection needs a reason, then approves
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000001', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.expect_error(format('SELECT public.hms_v7_merge_decide(%L,true,NULL,NULL,NULL)', hms_test.get('merge1')), 'ID_CHECK_REQUIRED');
SELECT hms_test.expect_error(format('SELECT public.hms_v7_merge_decide(%L,false,NULL,NULL,NULL)', hms_test.get('merge1')), 'INVALID_REQUEST');
SELECT hms_test.expect_error(format('SELECT public.hms_v7_merge_decide(%L,true,%L,%L::jsonb,NULL)', hms_test.get('merge1'), 'aadhaar', '{"name":"other"}'), 'INVALID_REQUEST');
SELECT hms_test.ok((SELECT jsonb_array_length(x->'pending') = 1 AND NOT (x->'pending'->0->>'mine')::boolean FROM (SELECT public.hms_v7_merges(hms_test.get('org')::uuid, hms_test.get('branch')::uuid) x) z), 'admin sees the pending proposal');
SELECT hms_test.ok(public.hms_v7_merge_decide(hms_test.get('merge1')::uuid, true, 'aadhaar', '{"name":"merged"}'::jsonb, 'Aadhaar seen at desk')->>'aliasMrn' = hms_test.get('online_mrn'), 'merge approved; online UHID becomes an alias');
COMMIT;
DO $$ BEGIN
  PERFORM hms_test.ok((SELECT merged_into FROM hms.patients WHERE id = hms_test.get('online_pat')::uuid) = hms_test.get('walkin')::uuid, 'merged record points to the survivor');
  PERFORM hms_test.ok((SELECT patient_id FROM hms.appointments WHERE id = hms_test.get('online_appt')::uuid) = hms_test.get('walkin')::uuid, 'appointment moved');
  PERFORM hms_test.ok((SELECT patient_id FROM hms.encounters WHERE appointment_id = hms_test.get('online_appt')::uuid) = hms_test.get('walkin')::uuid, 'encounter followed the appointment');
  PERFORM hms_test.ok((SELECT e.patient_id FROM hms.prescriptions r JOIN hms.encounters e ON e.id = r.encounter_id WHERE r.id = hms_test.get('t15_rx')::uuid) = hms_test.get('walkin')::uuid, 'prescription is now in the surviving record');
  PERFORM hms_test.ok((SELECT patient_mrn_snapshot FROM hms.prescriptions WHERE id = hms_test.get('t15_rx')::uuid) = hms_test.get('online_mrn'), 'prescription keeps the UHID it was issued under');
  PERFORM hms_test.ok((SELECT patient_id FROM hms.patient_owners WHERE user_id = 'a0000000-0000-4000-8000-00000000000e') = hms_test.get('walkin')::uuid, 'online account now opens the surviving record');
  PERFORM hms_test.ok((SELECT full_name FROM hms.patients WHERE id = hms_test.get('walkin')::uuid) = 'Sunita Sharma', 'approver''s name choice applied');
  PERFORM hms_test.ok((SELECT status FROM hms.patient_duplicate_flags WHERE patient_id = hms_test.get('online_pat')::uuid AND candidate_id = hms_test.get('walkin')::uuid) = 'merged', 'flag resolved as merged');
  PERFORM hms_test.ok((SELECT id_check_type FROM hms.patient_merges WHERE id = hms_test.get('merge1')::uuid) = 'aadhaar', 'ID document type recorded (no number)');
END $$;
BEGIN; -- old UHID still finds the patient; merged record no longer listed separately
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000003', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok((SELECT jsonb_array_length(r) = 1 AND r->0->>'mrn' = hms_test.get('walkin_mrn') FROM (SELECT public.hms_staff_patients(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, hms_test.get('online_mrn')) r) z), 'old UHID finds the surviving patient');
SELECT hms_test.ok((SELECT count(*) = 1 FROM jsonb_array_elements(public.hms_staff_patients(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, 'sunita')) e), 'only one Sunita listed after merge');
COMMIT;
BEGIN; -- the doctor's timeline opened with the old UHID resolves to the surviving record
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000002', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok((SELECT t->>'mrn' = hms_test.get('walkin_mrn') AND t->'formerUhids' ? hms_test.get('online_mrn')
  FROM (SELECT public.hms_v4_patient_timeline(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, hms_test.get('online_mrn'), 0) t) z), 'timeline via old UHID shows the merged record and former UHIDs');
COMMIT;
BEGIN; -- the online patient now sees the surviving UHID
SELECT hms_test.claims('a0000000-0000-4000-8000-00000000000e', 'aal1');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok(public.hms_v3_patient_records('test-hospital')->'profile'->>'mrn' = hms_test.get('walkin_mrn'), 'patient portal shows the surviving UHID');
COMMIT;
BEGIN; -- undo (no time limit by default): reason required, everything moves back
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000001', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.expect_error(format('SELECT public.hms_v7_merge_undo(%L,NULL)', hms_test.get('merge1')), 'INVALID_REQUEST');
SELECT hms_test.ok(public.hms_v7_merge_undo(hms_test.get('merge1')::uuid, 'Wrong merge: twin sisters')->>'status' = 'undone', 'merge undone');
SELECT hms_test.expect_error(format('SELECT public.hms_v7_merge_undo(%L,%L)', hms_test.get('merge1'), 'again please'), 'INVALID_STATUS');
COMMIT;
DO $$ BEGIN
  PERFORM hms_test.ok((SELECT merged_into IS NULL FROM hms.patients WHERE id = hms_test.get('online_pat')::uuid), 'record restored');
  PERFORM hms_test.ok((SELECT patient_id FROM hms.appointments WHERE id = hms_test.get('online_appt')::uuid) = hms_test.get('online_pat')::uuid, 'appointment moved back');
  PERFORM hms_test.ok((SELECT patient_id FROM hms.encounters WHERE appointment_id = hms_test.get('online_appt')::uuid) = hms_test.get('online_pat')::uuid, 'encounter moved back');
  PERFORM hms_test.ok((SELECT patient_id FROM hms.patient_owners WHERE user_id = 'a0000000-0000-4000-8000-00000000000e') = hms_test.get('online_pat')::uuid, 'online account moved back');
  PERFORM hms_test.ok((SELECT full_name FROM hms.patients WHERE id = hms_test.get('walkin')::uuid) = 'Smt. Sunitha Sharma', 'survivor details restored');
  PERFORM hms_test.ok(NOT EXISTS (SELECT 1 FROM hms.patient_uhid_aliases WHERE merge_id = hms_test.get('merge1')::uuid), 'alias removed');
END $$;
-- When the hospital later sets an undo window, older merges can no longer be undone.
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000003', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.put('merge2', public.hms_v7_merge_propose(hms_test.get('org')::uuid, hms_test.get('branch')::uuid, hms_test.get('online_pat')::uuid, hms_test.get('walkin')::uuid, NULL)->>'mergeId');
COMMIT;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000001', 'aal2');
SET LOCAL ROLE authenticated;
SELECT public.hms_v7_merge_decide(hms_test.get('merge2')::uuid, true, 'passport', NULL, NULL);
COMMIT;
UPDATE hms.hospital_settings SET merge_undo_days = 30 WHERE organization_id = hms_test.get('org')::uuid;
UPDATE hms.patient_merges SET decided_at = now() - interval '31 days' WHERE id = hms_test.get('merge2')::uuid;
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000001', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.ok(NOT (public.hms_v7_merges(hms_test.get('org')::uuid, hms_test.get('branch')::uuid)->'recent'->0->>'canUndo')::boolean, 'list shows undo no longer available');
SELECT hms_test.expect_error(format('SELECT public.hms_v7_merge_undo(%L,%L)', hms_test.get('merge2'), 'too late now'), 'UNDO_WINDOW_CLOSED');
COMMIT;
UPDATE hms.hospital_settings SET merge_undo_days = NULL WHERE organization_id = hms_test.get('org')::uuid;
-- Proposer cannot approve their own proposal; proposer can cancel.
BEGIN;
SELECT hms_test.claims('a0000000-0000-4000-8000-000000000001', 'aal2');
SET LOCAL ROLE authenticated;
SELECT hms_test.put('merge3', public.hms_v7_merge_propose(hms_test.get('org')::uuid, hms_test.get('branch')::uuid,
  hms_test.get('ramesh1')::uuid, hms_test.get('ramesh2')::uuid, NULL)->>'mergeId');
SELECT hms_test.expect_error(format('SELECT public.hms_v7_merge_decide(%L,true,%L,NULL,NULL)', hms_test.get('merge3'), 'pan'), 'SECOND_PERSON_REQUIRED');
SELECT hms_test.ok(public.hms_v7_merge_cancel(hms_test.get('merge3')::uuid)->>'status' = 'cancelled', 'proposer cancels');
COMMIT;
DO $$ BEGIN
  PERFORM hms_test.ok((SELECT count(DISTINCT action) FROM hms.audit_logs WHERE action IN ('patient.duplicate_check', 'patient.register', 'patient.register.override',
    'patient.duplicates.read', 'patient.merge.proposed', 'patient.merge.approved', 'patient.merge.undone', 'patient.merge.cancelled')) = 8, 'every step audited');
  PERFORM hms_test.ok(NOT EXISTS (SELECT 1 FROM hms.audit_logs WHERE to_jsonb(audit_logs)::text ILIKE '%sunita%' OR to_jsonb(audit_logs)::text LIKE '%9800000001%'), 'no names or phone numbers in the audit log');
END $$;
\echo 'ok T15 duplicates: match levels, shared phone not a match, registration override with reason, DOB-required online booking flags silently, two-person merge with ID check, oldest UHID survives, alias lookup, records and account move, undo (unlimited, then window), audit'
