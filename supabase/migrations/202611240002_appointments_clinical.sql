BEGIN;
SET LOCAL search_path = hms, extensions, public, pg_catalog;
-- Pre-generated appointment inventory. Exclusion prevents overlapping slots for one doctor even across branches.
CREATE TABLE hms.appointment_slots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_id uuid NOT NULL, doctor_id uuid NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, enabled boolean NOT NULL DEFAULT true,
 CHECK(starts_at<ends_at), UNIQUE(organization_id,id), UNIQUE(organization_id,branch_id,doctor_id,id),
 FOREIGN KEY(organization_id,doctor_id,branch_id) REFERENCES hms.doctor_branches(organization_id,doctor_id,branch_id),
 EXCLUDE USING gist (organization_id WITH =, doctor_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)
);
CREATE TABLE hms.appointments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_id uuid NOT NULL,
 doctor_id uuid NOT NULL, patient_id uuid NOT NULL, slot_id uuid NOT NULL, reference text NOT NULL,
 status text NOT NULL DEFAULT 'held' CHECK(status IN ('held','confirmed','checked_in','in_consultation','completed','cancelled','expired','no_show','rescheduled')),
 source text NOT NULL CHECK(source IN ('online','walk_in','staff','follow_up')),
 visit_type text NOT NULL DEFAULT 'consultation', hold_expires_at timestamptz,
 fee_paise bigint NOT NULL CHECK(fee_paise>=0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'held' OR hold_expires_at IS NOT NULL), UNIQUE(organization_id,id), UNIQUE(organization_id,branch_id,id),
 UNIQUE(organization_id,branch_id,id,patient_id,doctor_id), UNIQUE(organization_id,reference),
 FOREIGN KEY(organization_id,branch_id,doctor_id,slot_id) REFERENCES hms.appointment_slots(organization_id,branch_id,doctor_id,id),
 FOREIGN KEY(organization_id,patient_id,branch_id) REFERENCES hms.patient_branches(organization_id,patient_id,branch_id)
);
-- Expired holds remain blocking until a transaction explicitly expires them. Never use now() in an index predicate.
CREATE UNIQUE INDEX one_live_appointment_per_slot ON hms.appointments(organization_id,slot_id)
 WHERE status IN ('held','confirmed','checked_in','in_consultation','completed','no_show');
CREATE INDEX appointments_branch_status ON hms.appointments(organization_id,branch_id,status);
CREATE INDEX appointments_patient ON hms.appointments(organization_id,patient_id,created_at DESC);
CREATE INDEX appointment_holds_expiry ON hms.appointments(hold_expires_at) WHERE status='held';
CREATE INDEX appointment_slots_lookup ON hms.appointment_slots(organization_id,doctor_id,branch_id,starts_at);
CREATE TABLE hms.appointment_status_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id uuid NOT NULL, appointment_id uuid NOT NULL,
 from_status text, to_status text NOT NULL, actor_user_id uuid REFERENCES auth.users(id), reason_code text,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,appointment_id) REFERENCES hms.appointments(organization_id,id)
);
CREATE TABLE hms.encounters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_id uuid NOT NULL,
 appointment_id uuid NOT NULL, patient_id uuid NOT NULL, doctor_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','signed','amended','void')),
 started_at timestamptz NOT NULL DEFAULT now(), signed_at timestamptz,
 UNIQUE(organization_id,id), UNIQUE(organization_id,branch_id,id), UNIQUE(organization_id,appointment_id),
 FOREIGN KEY(organization_id,branch_id,appointment_id,patient_id,doctor_id) REFERENCES hms.appointments(organization_id,branch_id,id,patient_id,doctor_id)
);
CREATE TABLE hms.vitals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, encounter_id uuid NOT NULL,
 measurements jsonb NOT NULL CHECK(jsonb_typeof(measurements)='object'), recorded_at timestamptz NOT NULL DEFAULT now(),
 recorded_by uuid REFERENCES auth.users(id), FOREIGN KEY(organization_id,encounter_id) REFERENCES hms.encounters(organization_id,id)
);
CREATE TABLE hms.clinical_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, encounter_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 body text NOT NULL, author_user_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), signed_at timestamptz,
 UNIQUE(organization_id,encounter_id,version), FOREIGN KEY(organization_id,encounter_id) REFERENCES hms.encounters(organization_id,id)
);
CREATE TABLE hms.diagnoses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, encounter_id uuid NOT NULL,
 coding_system text, code text, display_text text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,encounter_id) REFERENCES hms.encounters(organization_id,id)
);
CREATE TABLE hms.prescriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, encounter_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','signed','superseded','void')),
 signed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id), UNIQUE(organization_id,encounter_id,version),
 FOREIGN KEY(organization_id,encounter_id) REFERENCES hms.encounters(organization_id,id)
);
CREATE TABLE hms.prescription_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, prescription_id uuid NOT NULL,
 medication_name text NOT NULL, dose_text text NOT NULL, frequency_text text NOT NULL, duration_text text, instructions text,
 FOREIGN KEY(organization_id,prescription_id) REFERENCES hms.prescriptions(organization_id,id)
);
CREATE TABLE hms.patient_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_id uuid NOT NULL, patient_id uuid NOT NULL,
 storage_path text NOT NULL UNIQUE, mime_type text NOT NULL, byte_size bigint NOT NULL CHECK(byte_size>0),
 document_type text NOT NULL, uploaded_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,patient_id,branch_id) REFERENCES hms.patient_branches(organization_id,patient_id,branch_id)
);
-- Server-only transaction helper; no direct RPC access for clients. Status-history, patient assignment,
-- fee validation, slot-enabled checks and audit events must be composed in the live service transaction.
CREATE FUNCTION hms_private.expire_slot_holds(p_org uuid,p_slot uuid) RETURNS integer
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer;
BEGIN
  PERFORM 1 FROM hms.appointment_slots WHERE organization_id=p_org AND id=p_slot FOR UPDATE;
  WITH expired AS (
    UPDATE hms.appointments SET status='expired',updated_at=now()
    WHERE organization_id=p_org AND slot_id=p_slot AND status='held' AND hold_expires_at<=now()
    RETURNING organization_id,id
  ) INSERT INTO hms.appointment_status_history(organization_id,appointment_id,from_status,to_status,reason_code)
  SELECT organization_id,id,'held','expired','hold_timeout' FROM expired;
  GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END; $$;
REVOKE ALL ON FUNCTION hms_private.expire_slot_holds(uuid,uuid) FROM PUBLIC,anon,authenticated;
COMMIT;
