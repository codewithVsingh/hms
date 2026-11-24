BEGIN;
-- 022: prescription corrections (HMS-017). Business rules: docs/BUSINESS_RULES.md section 7.
--
-- An issued prescription is never edited or deleted. Corrections are new rows:
--   AMEND     The issuing doctor creates version N+1 within the amendment window (hospital setting
--             rx_amend_hours, default 72 hours from the FIRST issue of that prescription). The
--             previous version becomes 'superseded' and stays readable by clinicians. A reason is
--             required; a note is required when the reason is 'other'. The amendment keeps the
--             previous version's patient-portal release setting so a correction can't silently hide
--             a prescription. The patient is notified ('prescription_updated', no clinical content).
--   WITHDRAW  For a prescription that should not exist (e.g. wrong patient). Two people:
--             the issuing doctor requests (any time), and a DIFFERENT person confirms: another
--             doctor in the branch (prescriptions.issue) or an administrator (settings.manage).
--             While a request is pending the prescription is hidden from the patient portal (a
--             reversible privacy measure: it may contain another patient's medicines). Approved:
--             status 'void', permanently hidden from the patient, kept for clinicians; patient
--             notified ('prescription_withdrawn'). Rejected or cancelled: visible again.
--   RECALL    If a superseded or withdrawn version had been printed or handed over on paper,
--             reception sees it in the prescription register until they confirm the paper copy
--             was recalled.

ALTER TABLE hms.hospital_settings
  ADD COLUMN rx_amend_hours integer NOT NULL DEFAULT 72 CHECK (rx_amend_hours BETWEEN 1 AND 720);

ALTER TABLE hms.prescriptions
  ADD COLUMN supersedes_id uuid REFERENCES hms.prescriptions(id),
  ADD COLUMN amend_reason text CHECK (amend_reason IS NULL OR amend_reason IN ('typo', 'dose_change', 'wrong_medicine', 'instructions', 'follow_up', 'other')),
  ADD COLUMN amend_note text CHECK (amend_note IS NULL OR length(amend_note) <= 500),
  ADD COLUMN superseded_at timestamptz,
  ADD COLUMN withdrawn_at timestamptz,
  ADD CONSTRAINT prescriptions_amend_consistency CHECK ((supersedes_id IS NULL) = (amend_reason IS NULL));

-- At most one current (signed) version per encounter, also under concurrent amendments.
CREATE UNIQUE INDEX prescriptions_one_signed_per_encounter ON hms.prescriptions (encounter_id) WHERE status = 'signed';

CREATE TABLE hms.prescription_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  prescription_id uuid NOT NULL REFERENCES hms.prescriptions(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reason_code text NOT NULL CHECK (reason_code IN ('wrong_patient', 'issued_in_error', 'duplicate', 'other')),
  note text CHECK (note IS NULL OR length(note) <= 500),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  CHECK ((status IN ('pending', 'cancelled')) = (decided_by IS NULL)),
  CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CHECK (reason_code <> 'other' OR nullif(trim(note), '') IS NOT NULL)
);
CREATE UNIQUE INDEX prescription_withdrawals_one_pending ON hms.prescription_withdrawals (prescription_id) WHERE status = 'pending';
ALTER TABLE hms.prescription_withdrawals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hms.prescription_withdrawals FROM PUBLIC, anon, authenticated;

ALTER TABLE hms.prescription_handover
  ADD COLUMN recalled_at timestamptz,
  ADD COLUMN recalled_by uuid REFERENCES auth.users(id);

-- Visible to the patient: current, released, and not awaiting withdrawal.
CREATE FUNCTION hms_private.v6_rx_patient_visible(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM hms.prescriptions r WHERE r.id = p_id AND r.status = 'signed' AND r.release_to_patient
    AND NOT EXISTS (SELECT 1 FROM hms.prescription_withdrawals w WHERE w.prescription_id = r.id AND w.status = 'pending')) $$;

-- Prescription view: adds correction metadata. Previous versions are never embedded here (this
-- view is also shown to patients); clinicians fetch them with hms_v6_rx_history.
CREATE OR REPLACE FUNCTION hms_private.v3_rx_view(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', r.id, 'version', r.version, 'status', r.status, 'issuedAt', r.signed_at,
    'doctor', coalesce(r.doctor_name_snapshot, d.display_name),
    'registration', coalesce(r.registration_snapshot, d.registration_number),
    'patient', coalesce(r.patient_name_snapshot, p.full_name),
    'mrn', coalesce(r.patient_mrn_snapshot, p.mrn),
    'followUp', r.follow_up_on, 'released', r.release_to_patient,
    'firstIssuedAt', (SELECT min(x.signed_at) FROM hms.prescriptions x WHERE x.encounter_id = r.encounter_id),
    'replaces', (SELECT jsonb_build_object('version', o.version, 'issuedAt', o.signed_at) FROM hms.prescriptions o WHERE o.id = r.supersedes_id),
    'amendUntil', (SELECT min(x.signed_at) FROM hms.prescriptions x WHERE x.encounter_id = r.encounter_id)
                  + make_interval(hours => coalesce((SELECT hs.rx_amend_hours FROM hms.hospital_settings hs WHERE hs.organization_id = e.organization_id AND hs.branch_id = e.branch_id), 72)),
    'mine', coalesce(r.issued_by = auth.uid(), false),
    'withdrawalPending', EXISTS (SELECT 1 FROM hms.prescription_withdrawals w WHERE w.prescription_id = r.id AND w.status = 'pending'),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('medicine', i.medication_name, 'dose', i.dose_text, 'frequency', i.frequency_text,
                'duration', i.duration_text, 'instructions', i.instructions) ORDER BY i.id)
              FROM hms.prescription_items i WHERE i.prescription_id = r.id), '[]'::jsonb))
  FROM hms.prescriptions r JOIN hms.encounters e ON e.id = r.encounter_id
  JOIN hms.doctors d ON d.id = e.doctor_id JOIN hms.patients p ON p.id = e.patient_id
  WHERE r.id = p_id;
$$;

-- Caller must be the issuing doctor with clinical write access to the visit.
CREATE FUNCTION hms_private.v6_rx_issuer_access(p_rx uuid) RETURNS hms.prescriptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r hms.prescriptions%ROWTYPE; e hms.encounters%ROWTYPE;
BEGIN
  SELECT * INTO r FROM hms.prescriptions WHERE id = p_rx;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO e FROM hms.encounters WHERE id = r.encounter_id;
  PERFORM hms_private.v3_clinical_access(e.appointment_id, true);
  IF NOT hms_private.staff_permission(e.organization_id, e.branch_id, 'prescriptions.issue') OR r.issued_by IS DISTINCT FROM auth.uid()
  THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN r;
END $$;

CREATE FUNCTION public.hms_v6_rx_amend(p_rx uuid, p_items jsonb, p_follow date, p_reason text, p_note text, p_attest boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r hms.prescriptions%ROWTYPE; e hms.encounters%ROWTYPE; d hms.doctors%ROWTYPE; p hms.patients%ROWTYPE;
  first_issue timestamptz; window_hours integer; ver integer; nid uuid; item jsonb; paper boolean;
BEGIN
  r := hms_private.v6_rx_issuer_access(p_rx);
  SELECT * INTO r FROM hms.prescriptions WHERE id = p_rx FOR UPDATE;
  SELECT * INTO e FROM hms.encounters WHERE id = r.encounter_id;
  IF p_attest IS DISTINCT FROM true OR p_reason IS NULL
     OR p_reason NOT IN ('typo', 'dose_change', 'wrong_medicine', 'instructions', 'follow_up', 'other')
     OR (p_reason = 'other' AND nullif(trim(coalesce(p_note, '')), '') IS NULL)
     OR length(coalesce(p_note, '')) > 500
     OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 25
     OR (p_follow IS NOT NULL AND p_follow < current_date)
  THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF r.status <> 'signed' THEN RAISE EXCEPTION 'NOT_CURRENT_VERSION'; END IF;
  IF EXISTS (SELECT 1 FROM hms.prescription_withdrawals WHERE prescription_id = r.id AND status = 'pending') THEN RAISE EXCEPTION 'WITHDRAWAL_PENDING'; END IF;
  SELECT min(signed_at) INTO first_issue FROM hms.prescriptions WHERE encounter_id = r.encounter_id;
  SELECT coalesce((SELECT rx_amend_hours FROM hms.hospital_settings WHERE organization_id = e.organization_id AND branch_id = e.branch_id), 72) INTO window_hours;
  IF now() > first_issue + make_interval(hours => window_hours) THEN RAISE EXCEPTION 'AMEND_WINDOW_CLOSED'; END IF;
  SELECT * INTO d FROM hms.doctors WHERE id = e.doctor_id;
  SELECT * INTO p FROM hms.patients WHERE id = e.patient_id;
  SELECT max(version) + 1 INTO ver FROM hms.prescriptions WHERE encounter_id = r.encounter_id;

  UPDATE hms.prescriptions SET status = 'superseded', superseded_at = now() WHERE id = r.id;
  INSERT INTO hms.prescriptions (organization_id, encounter_id, version, status, signed_at, issued_by, follow_up_on, release_to_patient,
      doctor_name_snapshot, registration_snapshot, patient_name_snapshot, patient_mrn_snapshot, supersedes_id, amend_reason, amend_note)
    VALUES (r.organization_id, r.encounter_id, ver, 'signed', now(), auth.uid(), p_follow, r.release_to_patient,
      d.display_name, d.registration_number, p.full_name, p.mrn, r.id, p_reason, nullif(trim(coalesce(p_note, '')), ''))
    RETURNING id INTO nid;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF coalesce(length(trim(item->>'medicine')), 0) NOT BETWEEN 1 AND 180 OR coalesce(length(trim(item->>'dose')), 0) NOT BETWEEN 1 AND 100
       OR coalesce(length(trim(item->>'frequency')), 0) NOT BETWEEN 1 AND 100 OR coalesce(length(trim(item->>'duration')), 0) NOT BETWEEN 1 AND 100
       OR length(coalesce(item->>'instructions', '')) > 500
    THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
    INSERT INTO hms.prescription_items (organization_id, prescription_id, medication_name, dose_text, frequency_text, duration_text, instructions)
      VALUES (r.organization_id, nid, trim(item->>'medicine'), trim(item->>'dose'), trim(item->>'frequency'), trim(item->>'duration'), item->>'instructions');
  END LOOP;
  paper := EXISTS (SELECT 1 FROM hms.prescription_handover h WHERE h.prescription_id = r.id AND h.method IN ('printed', 'paper_copy'));
  PERFORM hms_private.v3_audit(e.organization_id, e.branch_id, 'prescription.amended', 'prescription', nid);
  RETURN hms_private.v3_rx_view(nid) || jsonb_build_object('paperCopyToRecall', paper);
END $$;

CREATE FUNCTION public.hms_v6_rx_withdraw_request(p_rx uuid, p_reason text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r hms.prescriptions%ROWTYPE; e hms.encounters%ROWTYPE; wid uuid;
BEGIN
  r := hms_private.v6_rx_issuer_access(p_rx);
  SELECT * INTO r FROM hms.prescriptions WHERE id = p_rx FOR UPDATE;
  SELECT * INTO e FROM hms.encounters WHERE id = r.encounter_id;
  IF p_reason IS NULL OR p_reason NOT IN ('wrong_patient', 'issued_in_error', 'duplicate', 'other')
     OR (p_reason = 'other' AND nullif(trim(coalesce(p_note, '')), '') IS NULL) OR length(coalesce(p_note, '')) > 500
  THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF r.status <> 'signed' THEN RAISE EXCEPTION 'NOT_CURRENT_VERSION'; END IF;
  IF EXISTS (SELECT 1 FROM hms.prescription_withdrawals WHERE prescription_id = r.id AND status = 'pending') THEN RAISE EXCEPTION 'WITHDRAWAL_PENDING'; END IF;
  INSERT INTO hms.prescription_withdrawals (organization_id, branch_id, prescription_id, reason_code, note, requested_by)
    VALUES (e.organization_id, e.branch_id, r.id, p_reason, nullif(trim(coalesce(p_note, '')), ''), auth.uid()) RETURNING id INTO wid;
  PERFORM hms_private.v3_audit(e.organization_id, e.branch_id, 'prescription.withdraw.requested', 'prescription', r.id);
  RETURN jsonb_build_object('withdrawalId', wid, 'status', 'pending');
END $$;

CREATE FUNCTION public.hms_v6_rx_withdraw_cancel(p_withdrawal uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w hms.prescription_withdrawals%ROWTYPE;
BEGIN
  SELECT * INTO w FROM hms.prescription_withdrawals WHERE id = p_withdrawal FOR UPDATE;
  IF NOT FOUND OR w.requested_by IS DISTINCT FROM auth.uid() OR NOT hms_private.staff_permission(w.organization_id, w.branch_id, 'prescriptions.issue')
  THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF w.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  UPDATE hms.prescription_withdrawals SET status = 'cancelled' WHERE id = w.id;
  PERFORM hms_private.v3_audit(w.organization_id, w.branch_id, 'prescription.withdraw.cancelled', 'prescription', w.prescription_id);
  RETURN jsonb_build_object('status', 'cancelled');
END $$;

CREATE FUNCTION public.hms_v6_rx_withdraw_decide(p_withdrawal uuid, p_approve boolean, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w hms.prescription_withdrawals%ROWTYPE; r hms.prescriptions%ROWTYPE; aid uuid;
BEGIN
  SELECT * INTO w FROM hms.prescription_withdrawals WHERE id = p_withdrawal;
  IF NOT FOUND OR NOT (hms_private.staff_permission(w.organization_id, w.branch_id, 'prescriptions.issue')
                      OR hms_private.staff_permission(w.organization_id, w.branch_id, 'settings.manage'))
  THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF w.requested_by = auth.uid() THEN RAISE EXCEPTION 'SECOND_PERSON_REQUIRED'; END IF;
  IF p_approve IS NULL OR length(coalesce(p_note, '')) > 500 OR (p_approve = false AND nullif(trim(coalesce(p_note, '')), '') IS NULL)
  THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  SELECT * INTO r FROM hms.prescriptions WHERE id = w.prescription_id FOR UPDATE;
  SELECT * INTO w FROM hms.prescription_withdrawals WHERE id = p_withdrawal FOR UPDATE;
  IF w.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  UPDATE hms.prescription_withdrawals
    SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, decided_by = auth.uid(), decided_at = now(),
        decision_note = nullif(trim(coalesce(p_note, '')), '')
    WHERE id = w.id;
  IF p_approve THEN
    IF r.status <> 'signed' THEN RAISE EXCEPTION 'NOT_CURRENT_VERSION'; END IF;
    UPDATE hms.prescriptions SET status = 'void', withdrawn_at = now() WHERE id = r.id;
    IF r.release_to_patient THEN
      SELECT appointment_id INTO aid FROM hms.encounters WHERE id = r.encounter_id;
      PERFORM hms_private.v3_enqueue(aid, 'prescription_withdrawn', 'rx-withdrawn:' || r.id::text, now());
    END IF;
  END IF;
  PERFORM hms_private.v3_audit(w.organization_id, w.branch_id,
    CASE WHEN p_approve THEN 'prescription.withdraw.approved' ELSE 'prescription.withdraw.rejected' END, 'prescription', r.id);
  RETURN jsonb_build_object('status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END);
END $$;

CREATE FUNCTION public.hms_v6_rx_withdrawals(p_org uuid, p_branch uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE clinical boolean;
BEGIN
  clinical := hms_private.staff_permission(p_org, p_branch, 'prescriptions.issue');
  IF NOT (clinical OR hms_private.staff_permission(p_org, p_branch, 'settings.manage')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM hms_private.v3_audit(p_org, p_branch, 'prescription.withdrawals.read', 'branch', p_branch);
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q."requestedAt"), '[]'::jsonb) FROM (
    SELECT w.id, w.reason_code AS reason, w.note, w.requested_at AS "requestedAt",
           coalesce(pr.display_name, 'Staff member') AS "requestedBy", w.requested_by = auth.uid() AS mine,
           r.version, r.signed_at AS "issuedAt", r.patient_name_snapshot AS patient, r.patient_mrn_snapshot AS mrn,
           r.doctor_name_snapshot AS doctor,
           -- Medicines only for clinicians; administrators confirm on the documented reason.
           CASE WHEN clinical THEN (hms_private.v3_rx_view(r.id))->'items' END AS items
    FROM hms.prescription_withdrawals w
    JOIN hms.prescriptions r ON r.id = w.prescription_id
    LEFT JOIN hms.profiles pr ON pr.user_id = w.requested_by
    WHERE w.organization_id = p_org AND w.branch_id = p_branch AND w.status = 'pending'
    LIMIT 100) q);
END $$;

CREATE FUNCTION public.hms_v6_rx_history(p_rx uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e hms.encounters%ROWTYPE;
BEGIN
  SELECT en.* INTO e FROM hms.prescriptions r JOIN hms.encounters en ON en.id = r.encounter_id WHERE r.id = p_rx;
  IF NOT FOUND OR NOT hms_private.staff_permission(e.organization_id, e.branch_id, 'clinical.assigned.read')
     OR NOT hms_private.has_care_assignment(e.organization_id, e.branch_id, e.patient_id)
  THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM hms_private.v3_audit(e.organization_id, e.branch_id, 'prescription.history.read', 'patient', e.patient_id);
  RETURN (SELECT coalesce(jsonb_agg(hms_private.v3_rx_view(r.id) || jsonb_build_object(
      'amendReason', r.amend_reason, 'amendNote', r.amend_note, 'supersededAt', r.superseded_at, 'withdrawnAt', r.withdrawn_at,
      'amendedBy', (SELECT display_name FROM hms.profiles WHERE user_id = r.issued_by),
      'withdrawals', coalesce((SELECT jsonb_agg(jsonb_build_object('status', w.status, 'reason', w.reason_code, 'note', w.note,
            'requestedAt', w.requested_at, 'decidedAt', w.decided_at, 'decisionNote', w.decision_note,
            'decidedBy', (SELECT display_name FROM hms.profiles WHERE user_id = w.decided_by)) ORDER BY w.requested_at)
          FROM hms.prescription_withdrawals w WHERE w.prescription_id = r.id), '[]'::jsonb))
    ORDER BY r.version DESC), '[]'::jsonb)
    FROM hms.prescriptions r WHERE r.encounter_id = e.id);
END $$;

CREATE FUNCTION public.hms_v6_rx_recall_ack(p_rx uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h hms.prescription_handover%ROWTYPE; r hms.prescriptions%ROWTYPE;
BEGIN
  SELECT * INTO h FROM hms.prescription_handover WHERE prescription_id = p_rx FOR UPDATE;
  IF NOT FOUND OR NOT hms_private.staff_permission(h.organization_id, h.branch_id, 'prescriptions.archive') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO r FROM hms.prescriptions WHERE id = p_rx;
  IF r.status NOT IN ('superseded', 'void') OR h.method NOT IN ('printed', 'paper_copy') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF h.recalled_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'recalled', 'repeat', true); END IF;
  UPDATE hms.prescription_handover SET recalled_at = now(), recalled_by = auth.uid() WHERE prescription_id = p_rx;
  PERFORM hms_private.v3_audit(h.organization_id, h.branch_id, 'prescription.paper.recalled', 'prescription', p_rx);
  RETURN jsonb_build_object('status', 'recalled');
END $$;

-- Patient portal: hide prescriptions awaiting withdrawal (and, as before, superseded/void ones).
CREATE OR REPLACE FUNCTION public.hms_v3_patient_records(p_slug text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid; pid uuid;
BEGIN
  SELECT o.id, po.patient_id INTO org, pid FROM hms.organizations o JOIN hms.patient_owners po ON po.organization_id = o.id
    WHERE o.slug = p_slug AND o.active AND po.user_id = auth.uid();
  IF pid IS NULL THEN RETURN jsonb_build_object('profile', NULL, 'prescriptions', '[]'::jsonb, 'invoices', '[]'::jsonb); END IF;
  INSERT INTO hms.audit_logs (organization_id, actor_user_id, action, resource_type, resource_id, result)
    VALUES (org, auth.uid(), 'patient.self.records.read', 'patient', pid, 'success');
  RETURN jsonb_build_object(
    'profile', (SELECT jsonb_build_object('name', full_name, 'mrn', mrn, 'birthDate', birth_date) FROM hms.patients WHERE id = pid),
    'prescriptions', coalesce((SELECT jsonb_agg(hms_private.v3_rx_view(q.id) - 'mine' - 'amendUntil' - 'withdrawalPending') FROM (
        SELECT r.id FROM hms.prescriptions r JOIN hms.encounters e ON e.id = r.encounter_id
        WHERE e.organization_id = org AND e.patient_id = pid AND hms_private.v6_rx_patient_visible(r.id)
        ORDER BY r.created_at DESC LIMIT 100) q), '[]'::jsonb),
    'invoices', coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
        SELECT i.invoice_number, i.status, i.total_paise, i.issued_at, a.reference FROM hms.invoices i JOIN hms.appointments a ON a.id = i.appointment_id
        WHERE a.organization_id = org AND a.patient_id = pid AND i.status <> 'draft' ORDER BY i.created_at DESC LIMIT 100) q), '[]'::jsonb));
END $$;

-- Reception register: adds paper copies of superseded/withdrawn versions that still need recalling.
CREATE OR REPLACE FUNCTION public.hms_v4_rx_register(p_org uuid, p_branch uuid, p_mrn text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid uuid;
BEGIN
  IF NOT hms_private.staff_permission(p_org, p_branch, 'prescriptions.archive') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT p.id INTO pid FROM hms.patients p JOIN hms.patient_branches b ON b.organization_id = p.organization_id AND b.patient_id = p.id
    WHERE p.organization_id = p_org AND b.branch_id = p_branch AND upper(p.mrn) = upper(trim(p_mrn));
  IF pid IS NULL THEN RETURN NULL; END IF;
  PERFORM hms_private.v3_audit(p_org, p_branch, 'prescription.register.read', 'patient', pid);
  RETURN jsonb_build_object(
    'patient', (SELECT full_name FROM hms.patients WHERE id = pid), 'mrn', (SELECT mrn FROM hms.patients WHERE id = pid),
    'visits', coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
        SELECT a.id, a.reference, a.status, d.display_name doctor, s.starts_at FROM hms.appointments a JOIN hms.doctors d ON d.id = a.doctor_id
        JOIN hms.appointment_slots s ON s.id = a.slot_id
        WHERE a.organization_id = p_org AND a.branch_id = p_branch AND a.patient_id = pid AND a.status IN ('in_consultation', 'completed')
        ORDER BY s.starts_at DESC LIMIT 100) q), '[]'::jsonb),
    'prescriptions', coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
        SELECT r.id, a.reference, a.id appointment_id, r.signed_at, d.display_name doctor, r.version, h.handed_over_at, h.method,
               r.supersedes_id IS NOT NULL AS amended
        FROM hms.prescriptions r JOIN hms.encounters e ON e.id = r.encounter_id JOIN hms.appointments a ON a.id = e.appointment_id
        JOIN hms.doctors d ON d.id = e.doctor_id LEFT JOIN hms.prescription_handover h ON h.prescription_id = r.id
        WHERE e.organization_id = p_org AND e.branch_id = p_branch AND e.patient_id = pid AND r.status = 'signed'
          AND NOT EXISTS (SELECT 1 FROM hms.prescription_withdrawals w WHERE w.prescription_id = r.id AND w.status = 'pending')
        ORDER BY r.signed_at DESC LIMIT 100) q), '[]'::jsonb),
    'recall', coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
        SELECT r.id, a.reference, r.version, r.status, h.method, h.handed_over_at, d.display_name doctor
        FROM hms.prescriptions r JOIN hms.encounters e ON e.id = r.encounter_id JOIN hms.appointments a ON a.id = e.appointment_id
        JOIN hms.doctors d ON d.id = e.doctor_id JOIN hms.prescription_handover h ON h.prescription_id = r.id
        WHERE e.organization_id = p_org AND e.branch_id = p_branch AND e.patient_id = pid AND r.status IN ('superseded', 'void')
          AND h.method IN ('printed', 'paper_copy') AND h.recalled_at IS NULL
        ORDER BY h.handed_over_at DESC LIMIT 100) q), '[]'::jsonb),
    'paper', coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
        SELECT x.document_id, a.reference, x.uploaded_at, x.verified_at FROM hms.paper_prescription_archive x
        JOIN hms.appointments a ON a.id = x.appointment_id
        WHERE x.organization_id = p_org AND x.branch_id = p_branch AND a.patient_id = pid ORDER BY x.uploaded_at DESC LIMIT 100) q), '[]'::jsonb));
END $$;

-- Handover (portal release) must not record handover of a version awaiting withdrawal.
CREATE OR REPLACE FUNCTION public.hms_v4_rx_handover(p_id uuid, p_method text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a hms.appointments%ROWTYPE;
BEGIN
  SELECT ap.* INTO a FROM hms.prescriptions r JOIN hms.encounters e ON e.id = r.encounter_id JOIN hms.appointments ap ON ap.id = e.appointment_id
    WHERE r.id = p_id AND r.status = 'signed';
  IF a.id IS NULL OR NOT hms_private.staff_permission(a.organization_id, a.branch_id, 'prescriptions.archive') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_method NOT IN ('printed', 'patient_portal', 'paper_copy') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF EXISTS (SELECT 1 FROM hms.prescription_withdrawals WHERE prescription_id = p_id AND status = 'pending') THEN RAISE EXCEPTION 'WITHDRAWAL_PENDING'; END IF;
  IF p_method = 'patient_portal' AND NOT EXISTS (SELECT 1 FROM hms.prescriptions WHERE id = p_id AND release_to_patient) THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  INSERT INTO hms.prescription_handover (organization_id, branch_id, appointment_id, prescription_id, handed_over_by, handed_over_at, method)
    VALUES (a.organization_id, a.branch_id, a.id, p_id, auth.uid(), now(), p_method) ON CONFLICT (prescription_id) DO NOTHING;
  PERFORM hms_private.v3_audit(a.organization_id, a.branch_id, 'prescription.handover', 'prescription', p_id);
END $$;

-- Notifications: amendments get their own content-free template.
CREATE OR REPLACE FUNCTION hms_private.v3_notify_rx() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE aid uuid;
BEGIN
  IF NEW.status = 'signed' AND NEW.release_to_patient THEN
    SELECT appointment_id INTO aid FROM hms.encounters WHERE id = NEW.encounter_id;
    PERFORM hms_private.v3_enqueue(aid, CASE WHEN NEW.supersedes_id IS NULL THEN 'record_available' ELSE 'prescription_updated' END, 'rx:' || NEW.id::text, now());
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hms_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hms_v6_rx_amend(uuid, jsonb, date, text, text, boolean), public.hms_v6_rx_withdraw_request(uuid, text, text),
  public.hms_v6_rx_withdraw_cancel(uuid), public.hms_v6_rx_withdraw_decide(uuid, boolean, text), public.hms_v6_rx_withdrawals(uuid, uuid),
  public.hms_v6_rx_history(uuid), public.hms_v6_rx_recall_ack(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hms_v6_rx_amend(uuid, jsonb, date, text, text, boolean), public.hms_v6_rx_withdraw_request(uuid, text, text),
  public.hms_v6_rx_withdraw_cancel(uuid), public.hms_v6_rx_withdraw_decide(uuid, boolean, text), public.hms_v6_rx_withdrawals(uuid, uuid),
  public.hms_v6_rx_history(uuid), public.hms_v6_rx_recall_ack(uuid) TO authenticated;
COMMIT;
