BEGIN;
-- 021: doctor-unavailability workflow (HMS-016).
--
-- Before: adding leave was refused while any booking existed in the period (LEAVE_HAS_BOOKINGS),
-- so new bookings could keep landing while reception resolved the existing ones, and a hospital
-- cancellation recorded no reason and left refunds entirely manual.
--
-- Now:
--   1. hms_v5_leave_add records the unavailability immediately (with a reason). The leave blocks
--      new bookings, reschedules into the period and late payment captures straight away.
--   2. hms_v5_affected_bookings lists live bookings that overlap any current or future leave.
--   3. Each booking is either moved (existing hms_v3_reschedule, which already notifies the
--      patient) or cancelled with hms_v5_hospital_cancel: hospital-initiated, reason recorded,
--      ALWAYS a full refund (no cancellation fee), patient notified by the existing trigger.
--      - Online (Razorpay) payment: refund row 'requested' -> admin approval (hms_refund_claim)
--        or automatic when HMS_AUTO_POLICY_REFUNDS=true.
--      - Desk payment (cash / UPI / card / bank transfer): refund row 'requested', listed by
--        hms_v5_desk_refunds; billing settles it at the desk and records it with
--        hms_v5_record_desk_refund. Never sent to Razorpay.
--      - Unpaid: invoice voided, no refund.
--      - Anything unusual (several payments, reconciliation pending, earlier refunds) is refused
--        with PAYMENT_REVIEW so an administrator handles it in the existing refund screen.
-- The original hms_v3_leave_add is unchanged for compatibility.

ALTER TABLE hms.doctor_leaves
  ADD COLUMN reason_code text NOT NULL DEFAULT 'leave'
    CHECK (reason_code IN ('leave', 'unwell', 'emergency', 'training', 'holiday', 'other')),
  ADD COLUMN created_by uuid REFERENCES auth.users(id),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE hms.booking_cancellations
  ADD COLUMN initiated_by text NOT NULL DEFAULT 'patient' CHECK (initiated_by IN ('patient', 'hospital')),
  ADD COLUMN reason_code text;

ALTER TABLE hms.refunds ADD COLUMN settled_method text
  CHECK (settled_method IS NULL OR settled_method IN ('razorpay', 'cash', 'upi_offline', 'card_offline', 'bank_transfer'));

CREATE INDEX IF NOT EXISTS doctor_leaves_active_idx ON hms.doctor_leaves (organization_id, branch_id, ends_at);

-- Shared predicate: an appointment still occupying its slot.
CREATE FUNCTION hms_private.v5_is_live(p_status text, p_hold timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p_status IN ('confirmed', 'checked_in') OR (p_status = 'held' AND p_hold > now()) $$;

CREATE FUNCTION public.hms_v5_leave_add(p_org uuid, p_branch uuid, p_doctor uuid, p_start timestamptz, p_end timestamptz, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE lid uuid; affected integer;
BEGIN
  IF NOT (hms_private.staff_permission(p_org, p_branch, 'settings.manage')
      OR (hms_private.staff_permission(p_org, p_branch, 'appointments.assigned.read') AND hms_private.is_assigned_doctor(p_org, p_branch, p_doctor)))
  THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start OR p_end <= now() OR p_start < now() - interval '1 day'
     OR p_end > p_start + interval '90 days' OR p_reason IS NULL
     OR p_reason NOT IN ('leave', 'unwell', 'emergency', 'training', 'holiday', 'other')
  THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF NOT EXISTS (SELECT 1 FROM hms.doctor_branches WHERE organization_id = p_org AND branch_id = p_branch AND doctor_id = p_doctor AND active)
  THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  -- Same lock order as booking (slots, then doctor) so a booking in flight either commits first
  -- (and appears in the affected list) or sees the leave and is refused.
  PERFORM 1 FROM hms.appointment_slots WHERE organization_id = p_org AND doctor_id = p_doctor
    AND tstzrange(starts_at, ends_at, '[)') && tstzrange(p_start, p_end, '[)') ORDER BY id FOR UPDATE;
  PERFORM 1 FROM hms.doctors WHERE organization_id = p_org AND id = p_doctor FOR UPDATE;
  INSERT INTO hms.doctor_leaves (organization_id, branch_id, doctor_id, starts_at, ends_at, reason_code, created_by)
    VALUES (p_org, p_branch, p_doctor, p_start, p_end, p_reason, auth.uid()) RETURNING id INTO lid;
  SELECT count(*) INTO affected FROM hms.appointments a JOIN hms.appointment_slots s ON s.id = a.slot_id
    WHERE a.organization_id = p_org AND a.doctor_id = p_doctor AND hms_private.v5_is_live(a.status, a.hold_expires_at)
      AND tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(p_start, p_end, '[)');
  PERFORM hms_private.v3_audit(p_org, p_branch, 'doctor.leave.add', 'doctor_leave', lid);
  RETURN jsonb_build_object('leaveId', lid, 'affected', affected);
END $$;

CREATE FUNCTION public.hms_v5_affected_bookings(p_org uuid, p_branch uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE show_phone boolean;
BEGIN
  IF NOT (hms_private.staff_permission(p_org, p_branch, 'appointments.create') OR hms_private.staff_permission(p_org, p_branch, 'settings.manage'))
  THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  -- Phone numbers only for roles that may read branch demographics (reception, admin).
  show_phone := hms_private.staff_permission(p_org, p_branch, 'patients.demographics.read');
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q."startsAt"), '[]'::jsonb) FROM (
    SELECT DISTINCT ON (a.id)
      a.id, a.reference, a.status, s.starts_at AS "startsAt", d.display_name AS doctor, p.full_name AS patient, p.mrn,
      CASE WHEN show_phone THEN (SELECT c.contact_value FROM hms.patient_contacts c WHERE c.organization_id = a.organization_id AND c.patient_id = a.patient_id AND c.kind = 'phone' ORDER BY c.verified_at DESC NULLS LAST LIMIT 1) END AS phone,
      l.reason_code AS "leaveReason", l.ends_at AS "leaveEndsAt",
      coalesce((SELECT sum(pm.amount_paise) FROM hms.payments pm JOIN hms.invoices i ON i.id = pm.invoice_id WHERE i.appointment_id = a.id AND pm.status = 'captured'), 0) AS "paidPaise",
      (SELECT pm.method FROM hms.payments pm JOIN hms.invoices i ON i.id = pm.invoice_id WHERE i.appointment_id = a.id AND pm.status = 'captured' LIMIT 1) AS "paymentMethod"
    FROM hms.appointments a
    JOIN hms.appointment_slots s ON s.id = a.slot_id
    JOIN hms.doctor_leaves l ON l.organization_id = a.organization_id AND l.doctor_id = a.doctor_id
      AND tstzrange(l.starts_at, l.ends_at, '[)') && tstzrange(s.starts_at, s.ends_at, '[)')
    JOIN hms.doctors d ON d.id = a.doctor_id
    JOIN hms.patients p ON p.id = a.patient_id
    WHERE a.organization_id = p_org AND a.branch_id = p_branch AND l.ends_at > now()
      AND hms_private.v5_is_live(a.status, a.hold_expires_at)
    ORDER BY a.id, l.starts_at
    LIMIT 200) q);
END $$;

CREATE FUNCTION public.hms_v5_hospital_cancel(p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a hms.appointments%ROWTYPE; i hms.invoices%ROWTYPE; p hms.payments%ROWTYPE; s hms.appointment_slots%ROWTYPE;
  n_payments integer; rid uuid; old text; mode text := 'none'; tz text;
BEGIN
  SELECT * INTO a FROM hms.appointments WHERE id = p_id;
  IF NOT FOUND OR NOT (hms_private.staff_permission(a.organization_id, a.branch_id, 'appointments.create')
                      OR hms_private.staff_permission(a.organization_id, a.branch_id, 'settings.manage'))
  THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('doctor_unavailable', 'hospital_closure', 'other') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  -- Lock order: slot -> appointment -> invoice -> payments (as in payment capture and cancellation).
  PERFORM 1 FROM hms.appointment_slots WHERE id = a.slot_id FOR UPDATE;
  SELECT * INTO a FROM hms.appointments WHERE id = p_id FOR UPDATE;
  SELECT * INTO s FROM hms.appointment_slots WHERE id = a.slot_id;
  SELECT * INTO i FROM hms.invoices WHERE appointment_id = a.id FOR UPDATE;
  PERFORM 1 FROM hms.payments WHERE invoice_id = i.id FOR UPDATE;
  IF a.status = 'cancelled' AND EXISTS (SELECT 1 FROM hms.booking_cancellations WHERE appointment_id = a.id AND initiated_by = 'hospital') THEN
    RETURN (SELECT jsonb_build_object('cancelled', true, 'refundPaise', c.refund_paise, 'refundId', c.refund_id, 'repeat', true)
            FROM hms.booking_cancellations c WHERE c.appointment_id = a.id);
  END IF;
  SELECT timezone INTO tz FROM hms.branches WHERE id = a.branch_id;
  -- Held/confirmed future bookings, or a patient already checked in today.
  IF NOT (a.status IN ('held', 'confirmed') AND s.starts_at > now())
     AND NOT (a.status = 'checked_in' AND (s.starts_at AT TIME ZONE tz)::date = (now() AT TIME ZONE tz)::date)
  THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF EXISTS (SELECT 1 FROM hms.booking_cancellations WHERE appointment_id = a.id) THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;

  SELECT count(*) INTO n_payments FROM hms.payments WHERE invoice_id = i.id;
  IF n_payments = 0 THEN
    IF i.order_claim IS NOT NULL AND a.status = 'held' THEN
      -- Payment may be in flight: a late capture lands in reconciliation (appointment no longer
      -- held) and is refunded through the admin refund screen. Nothing to refund now.
      NULL;
    END IF;
  ELSIF n_payments = 1 THEN
    SELECT * INTO p FROM hms.payments WHERE invoice_id = i.id;
    IF p.status <> 'captured' OR EXISTS (SELECT 1 FROM hms.refunds WHERE payment_id = p.id)
       OR EXISTS (SELECT 1 FROM hms.payment_orders WHERE invoice_id = i.id AND status = 'reconciliation_required')
    THEN RAISE EXCEPTION 'PAYMENT_REVIEW'; END IF;
  ELSE
    RAISE EXCEPTION 'PAYMENT_REVIEW';
  END IF;

  IF p.id IS NOT NULL THEN
    rid := gen_random_uuid();
    INSERT INTO hms.refunds (id, organization_id, payment_id, amount_paise, status, reason_code, idempotency_key)
      VALUES (rid, a.organization_id, p.id, p.amount_paise, 'requested', p_reason, rid::text);
    mode := CASE WHEN p.method = 'razorpay' THEN 'online' ELSE 'desk' END;
  END IF;
  INSERT INTO hms.booking_cancellations (appointment_id, organization_id, branch_id, payment_id, refund_id, paid_paise,
      deduction_paise, refund_paise, policy_version, requested_by, requested_at, initiated_by, reason_code)
    VALUES (a.id, a.organization_id, a.branch_id, p.id, rid, coalesce(p.amount_paise, 0), 0, coalesce(p.amount_paise, 0),
      a.cancel_policy_version, auth.uid(), now(), 'hospital', p_reason);

  old := a.status;
  UPDATE hms.appointments SET status = 'cancelled', updated_at = now() WHERE id = a.id; -- trigger notifies the patient
  IF p.id IS NULL AND i.status IN ('issued', 'settled') AND i.order_claim IS NULL THEN
    UPDATE hms.invoices SET status = 'void' WHERE id = i.id;
  END IF;
  UPDATE hms.care_assignments ca SET revoked_at = now()
    WHERE ca.organization_id = a.organization_id AND ca.branch_id = a.branch_id AND ca.patient_id = a.patient_id
      AND ca.doctor_id = a.doctor_id AND ca.revoked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM hms.appointments a2 WHERE a2.id <> a.id AND a2.organization_id = a.organization_id
        AND a2.branch_id = a.branch_id AND a2.patient_id = a.patient_id AND a2.doctor_id = a.doctor_id
        AND a2.status IN ('confirmed', 'checked_in', 'in_consultation', 'completed'));
  INSERT INTO hms.appointment_status_history (organization_id, appointment_id, from_status, to_status, actor_user_id, reason_code)
    VALUES (a.organization_id, a.id, old, 'cancelled', auth.uid(), p_reason);
  PERFORM hms_private.v3_audit(a.organization_id, a.branch_id, 'appointment.hospital_cancel', 'appointment', a.id);
  RETURN jsonb_build_object('cancelled', true, 'refundPaise', coalesce(p.amount_paise, 0), 'refundId', rid, 'refundMode', mode);
END $$;

CREATE FUNCTION public.hms_v5_desk_refunds(p_org uuid, p_branch uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT hms_private.staff_permission(p_org, p_branch, 'payments.collect') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q."requestedAt"), '[]'::jsonb) FROM (
    SELECT r.id, r.amount_paise AS "amountPaise", p.method AS "paidBy", a.reference, pt.full_name AS patient, pt.mrn,
           c.reason_code AS reason, c.requested_at AS "requestedAt"
    FROM hms.refunds r
    JOIN hms.payments p ON p.id = r.payment_id
    JOIN hms.booking_cancellations c ON c.refund_id = r.id
    JOIN hms.appointments a ON a.id = c.appointment_id
    JOIN hms.patients pt ON pt.id = a.patient_id
    WHERE c.organization_id = p_org AND c.branch_id = p_branch AND p.method <> 'razorpay' AND r.status = 'requested'
    LIMIT 200) q);
END $$;

CREATE FUNCTION public.hms_v5_record_desk_refund(p_id uuid, p_method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r hms.refunds%ROWTYPE; p hms.payments%ROWTYPE; c hms.booking_cancellations%ROWTYPE;
BEGIN
  SELECT * INTO c FROM hms.booking_cancellations WHERE refund_id = p_id;
  IF NOT FOUND OR NOT hms_private.staff_permission(c.organization_id, c.branch_id, 'payments.collect') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash', 'upi_offline', 'card_offline', 'bank_transfer') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  SELECT * INTO r FROM hms.refunds WHERE id = p_id FOR UPDATE;
  SELECT * INTO p FROM hms.payments WHERE id = r.payment_id FOR UPDATE;
  IF p.method = 'razorpay' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF; -- online refunds go through the provider only
  IF r.status = 'processed' THEN RETURN jsonb_build_object('status', 'processed', 'repeat', true); END IF;
  IF r.status <> 'requested' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  -- Desk refunds are always the full payment (hospital-initiated cancellations).
  IF r.amount_paise <> p.amount_paise THEN RAISE EXCEPTION 'REFUND_MISMATCH'; END IF;
  UPDATE hms.refunds SET status = 'processed', approved_by = auth.uid(), settled_method = p_method WHERE id = r.id;
  UPDATE hms.payments SET status = 'refunded' WHERE id = p.id;
  UPDATE hms.invoices SET status = 'void' WHERE id = p.invoice_id
    AND NOT EXISTS (SELECT 1 FROM hms.payments p2 WHERE p2.invoice_id = p.invoice_id AND p2.status IN ('captured', 'pending', 'reconciliation_required', 'partially_refunded'));
  PERFORM hms_private.v3_audit(c.organization_id, c.branch_id, 'refund.desk_settled', 'refund', r.id);
  RETURN jsonb_build_object('status', 'processed');
END $$;

-- Automatic and admin online refund paths must never pick up desk refunds.
CREATE OR REPLACE FUNCTION public.hms_v4_claim_requested_refund(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r hms.refunds%ROWTYPE; p hms.payments%ROWTYPE;
BEGIN
  UPDATE hms.refunds SET status = 'processing'
    WHERE id = p_id AND status = 'requested'
      AND EXISTS (SELECT 1 FROM hms.booking_cancellations c WHERE c.refund_id = p_id)
      AND EXISTS (SELECT 1 FROM hms.payments pm WHERE pm.id = refunds.payment_id AND pm.method = 'razorpay')
    RETURNING * INTO r;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO p FROM hms.payments WHERE id = r.payment_id;
  RETURN jsonb_build_object('refundId', r.id, 'paymentId', p.provider_payment_id, 'amount', r.amount_paise, 'receipt', 'RF-' || replace(r.id::text, '-', ''));
END $$;

CREATE OR REPLACE FUNCTION public.hms_v4_requested_refunds(p_slug text, p_branch text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(q.id), '[]'::jsonb) FROM (
    SELECT r.id FROM hms.refunds r
    JOIN hms.payments pm ON pm.id = r.payment_id AND pm.method = 'razorpay'
    JOIN hms.booking_cancellations c ON c.refund_id = r.id
    JOIN hms.organizations o ON o.id = c.organization_id
    JOIN hms.branches b ON b.id = c.branch_id
    WHERE o.slug = p_slug AND b.code = p_branch AND r.status = 'requested'
    ORDER BY c.requested_at LIMIT 5) q;
$$;

REVOKE ALL ON FUNCTION hms_private.v5_is_live(text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hms_v5_leave_add(uuid, uuid, uuid, timestamptz, timestamptz, text),
  public.hms_v5_affected_bookings(uuid, uuid), public.hms_v5_hospital_cancel(uuid, text),
  public.hms_v5_desk_refunds(uuid, uuid), public.hms_v5_record_desk_refund(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hms_v5_leave_add(uuid, uuid, uuid, timestamptz, timestamptz, text),
  public.hms_v5_affected_bookings(uuid, uuid), public.hms_v5_hospital_cancel(uuid, text),
  public.hms_v5_desk_refunds(uuid, uuid), public.hms_v5_record_desk_refund(uuid, text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.hms_v4_claim_requested_refund(uuid), public.hms_v4_requested_refunds(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hms_v4_claim_requested_refund(uuid), public.hms_v4_requested_refunds(text, text) TO service_role;
COMMIT;
