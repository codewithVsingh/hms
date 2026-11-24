BEGIN;
-- 023: duplicate-patient detection and controlled merge (HMS-018).
-- Business rules: docs/BUSINESS_RULES.md section 10. Decisions approved 25 Nov 2026.
--
-- Detection never merges anything. Matching combines a tidied name with mobile number and date of
-- birth; a shared mobile alone is NOT a match (families share phones):
--   likely    same mobile + similar name + same date of birth
--   possible  same mobile + similar name + date of birth missing on one side, or day/month swapped
--   possible  similar name + same date of birth (different or no mobile)
--   no match  different gender, or both dates of birth known and different (not a day/month swap)
-- Where it is used:
--   * Reception registration (hms_v7_register): refused with POSSIBLE_DUPLICATE unless reception
--     picks the existing patient or registers anyway with a reason (recorded).
--   * Online booking (hms_v7_book_self): date of birth is now required (adult check); a NEW record
--     that matches existing ones is flagged silently for reception. Nothing is shown to the patient.
--   * On demand for one patient, and a review queue of open flags.
-- Merge: proposed by reception/admin, approved by a DIFFERENT administrator who records the ID
-- document type checked (never the number). The first-registered UHID always survives; the other
-- UHID becomes an alias that still finds the patient. Blocked when both records have separate
-- verified online accounts. Every moved row is logged so the merge can be undone; undo has no time
-- limit while hospital_settings.merge_undo_days is NULL (the default during the first months).

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ------------------------------------------------------------------ name and phone keys
CREATE FUNCTION hms_private.v7_norm_name(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  -- lower-case, letters only, drop titles, map common spelling variants, collapse repeated
  -- letters, then sort the words so word order does not matter.
  SELECT array_to_string(array(
    SELECT w FROM (
      SELECT regexp_replace(
        CASE t WHEN 'mohd' THEN 'mohammed' WHEN 'md' THEN 'mohammed' WHEN 'mohamed' THEN 'mohammed'
               WHEN 'muhammad' THEN 'mohammed' WHEN 'mohammad' THEN 'mohammed' WHEN 'laxmi' THEN 'lakshmi'
               WHEN 'kr' THEN 'kumar' ELSE t END, '(.)\1+', '\1', 'g') AS w
      FROM unnest(regexp_split_to_array(trim(regexp_replace(lower(coalesce(p, '')), '[^a-z]+', ' ', 'g')), ' ')) AS t
      WHERE t <> '' AND t NOT IN ('mr', 'mrs', 'ms', 'miss', 'smt', 'shri', 'sri', 'dr', 'master', 'baby', 'late')
    ) x ORDER BY w), ' ') $$;

CREATE FUNCTION hms_private.v7_phone10(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN length(d) >= 10 THEN right(d, 10) END FROM (SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x $$;

ALTER TABLE hms.patients
  ADD COLUMN name_key text,
  ADD COLUMN merged_into uuid REFERENCES hms.patients(id),
  ADD COLUMN merged_at timestamptz,
  ADD CONSTRAINT patients_not_merged_into_self CHECK (merged_into IS DISTINCT FROM id);
UPDATE hms.patients SET name_key = hms_private.v7_norm_name(full_name);

CREATE FUNCTION hms_private.v7_patient_name_key() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.name_key := hms_private.v7_norm_name(NEW.full_name); RETURN NEW; END $$;
CREATE TRIGGER patients_name_key BEFORE INSERT OR UPDATE OF full_name ON hms.patients
  FOR EACH ROW EXECUTE FUNCTION hms_private.v7_patient_name_key();

CREATE INDEX patients_name_key_trgm ON hms.patients USING gin (name_key extensions.gin_trgm_ops);
CREATE INDEX patients_birth_date_idx ON hms.patients (organization_id, birth_date) WHERE merged_into IS NULL;
CREATE INDEX patient_contacts_phone10_idx ON hms.patient_contacts (organization_id, hms_private.v7_phone10(contact_value)) WHERE kind = 'phone';

ALTER TABLE hms.hospital_settings
  ADD COLUMN merge_undo_days integer CHECK (merge_undo_days IS NULL OR merge_undo_days BETWEEN 1 AND 3650);
COMMENT ON COLUMN hms.hospital_settings.merge_undo_days IS 'NULL = merges can be undone at any time (default for the first months of operation).';

-- Moving an appointment to the surviving patient must carry its encounter along.
ALTER TABLE hms.encounters DROP CONSTRAINT encounters_organization_id_branch_id_appointment_id_patien_fkey;
ALTER TABLE hms.encounters ADD CONSTRAINT encounters_appointment_patient_fkey
  FOREIGN KEY (organization_id, branch_id, appointment_id, patient_id, doctor_id)
  REFERENCES hms.appointments (organization_id, branch_id, id, patient_id, doctor_id) ON UPDATE CASCADE;

-- ------------------------------------------------------------------ tables
CREATE TABLE hms.patient_uhid_aliases (
  organization_id uuid NOT NULL,
  mrn text NOT NULL,
  patient_id uuid NOT NULL REFERENCES hms.patients(id),
  merge_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, mrn)
);

CREATE TABLE hms.patient_duplicate_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  patient_id uuid NOT NULL REFERENCES hms.patients(id),
  candidate_id uuid NOT NULL REFERENCES hms.patients(id),
  level text NOT NULL CHECK (level IN ('likely', 'possible')),
  source text NOT NULL CHECK (source IN ('online_booking', 'registration', 'review')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'merged')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  resolution_note text CHECK (resolution_note IS NULL OR length(resolution_note) <= 300),
  CHECK (patient_id <> candidate_id),
  CHECK (status = 'open' OR resolved_at IS NOT NULL),
  CHECK (status <> 'dismissed' OR nullif(trim(resolution_note), '') IS NOT NULL)
);
CREATE UNIQUE INDEX patient_duplicate_flags_open_pair ON hms.patient_duplicate_flags
  (organization_id, least(patient_id, candidate_id), greatest(patient_id, candidate_id)) WHERE status = 'open';

CREATE TABLE hms.patient_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  survivor_id uuid NOT NULL REFERENCES hms.patients(id),
  merged_id uuid NOT NULL REFERENCES hms.patients(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'undone')),
  proposed_by uuid NOT NULL REFERENCES auth.users(id),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  proposal_note text CHECK (proposal_note IS NULL OR length(proposal_note) <= 500),
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  id_check_type text CHECK (id_check_type IS NULL OR id_check_type IN
    ('aadhaar', 'pan', 'passport', 'driving_licence', 'voter_id', 'other_government_id')),
  field_choices jsonb,
  previous_survivor jsonb,
  undone_by uuid REFERENCES auth.users(id),
  undone_at timestamptz,
  undo_note text CHECK (undo_note IS NULL OR length(undo_note) <= 500),
  CHECK (survivor_id <> merged_id),
  CHECK (decided_by IS NULL OR decided_by <> proposed_by),
  CHECK (status NOT IN ('approved', 'undone') OR id_check_type IS NOT NULL),
  CHECK (status <> 'rejected' OR nullif(trim(decision_note), '') IS NOT NULL),
  CHECK (status <> 'undone' OR (undone_at IS NOT NULL AND nullif(trim(undo_note), '') IS NOT NULL))
);
CREATE UNIQUE INDEX patient_merges_one_pending_per_patient_s ON hms.patient_merges (survivor_id) WHERE status = 'pending';
CREATE UNIQUE INDEX patient_merges_one_pending_per_patient_m ON hms.patient_merges (merged_id) WHERE status = 'pending';

CREATE TABLE hms.patient_merge_moves (
  merge_id uuid NOT NULL REFERENCES hms.patient_merges(id),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  table_name text NOT NULL,
  row_key jsonb NOT NULL,
  action text NOT NULL CHECK (action IN ('moved', 'inserted', 'revoked')),
  PRIMARY KEY (merge_id, seq)
);

ALTER TABLE hms.patient_uhid_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE hms.patient_duplicate_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE hms.patient_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE hms.patient_merge_moves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hms.patient_uhid_aliases, hms.patient_duplicate_flags, hms.patient_merges, hms.patient_merge_moves FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ matching
CREATE FUNCTION hms_private.v7_candidates(p_org uuid, p_name text, p_birth date, p_phone text, p_gender text, p_exclude uuid)
RETURNS TABLE (patient_id uuid, level text)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH q AS (SELECT hms_private.v7_norm_name(p_name) AS nk, hms_private.v7_phone10(p_phone) AS ph),
  pool AS (
    SELECT c.patient_id AS id FROM hms.patient_contacts c, q
      WHERE c.organization_id = p_org AND c.kind = 'phone' AND q.ph IS NOT NULL AND hms_private.v7_phone10(c.contact_value) = q.ph
    UNION
    SELECT x.id FROM hms.patients x WHERE x.organization_id = p_org AND p_birth IS NOT NULL AND x.birth_date = p_birth
  ),
  scored AS (
    SELECT x.id,
      EXISTS (SELECT 1 FROM hms.patient_contacts c, q WHERE c.organization_id = p_org AND c.patient_id = x.id AND c.kind = 'phone'
              AND q.ph IS NOT NULL AND hms_private.v7_phone10(c.contact_value) = q.ph) AS same_phone,
      extensions.similarity(x.name_key, q.nk) >= 0.45 AS similar_name,
      (p_birth IS NOT NULL AND x.birth_date = p_birth) AS same_dob,
      (p_birth IS NULL OR x.birth_date IS NULL) AS dob_missing,
      (p_birth IS NOT NULL AND x.birth_date IS NOT NULL AND x.birth_date <> p_birth
        AND extract(day FROM x.birth_date) = extract(month FROM p_birth) AND extract(month FROM x.birth_date) = extract(day FROM p_birth)
        AND extract(year FROM x.birth_date) = extract(year FROM p_birth)) AS dob_swapped,
      (p_gender IS NOT NULL AND x.gender IS NOT NULL AND lower(x.gender) <> lower(p_gender)) AS gender_conflict
    FROM hms.patients x JOIN pool ON pool.id = x.id, q
    WHERE x.organization_id = p_org AND x.merged_into IS NULL AND x.id IS DISTINCT FROM p_exclude
  )
  SELECT id, CASE WHEN same_phone AND same_dob THEN 'likely' ELSE 'possible' END
  FROM scored
  WHERE similar_name AND NOT gender_conflict
    AND ((same_phone AND (same_dob OR dob_missing OR dob_swapped)) OR (same_dob AND NOT same_phone))
$$;

CREATE FUNCTION hms_private.v7_summary(p_id uuid, p_branch uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', p.id, 'mrn', p.mrn, 'name', p.full_name, 'birthDate', p.birth_date, 'gender', p.gender,
    'registeredAt', p.created_at,
    'phoneLast4', (SELECT right(hms_private.v7_phone10(c.contact_value), 4) FROM hms.patient_contacts c WHERE c.patient_id = p.id AND c.kind = 'phone' ORDER BY c.verified_at DESC NULLS LAST LIMIT 1),
    'onlineAccount', EXISTS (SELECT 1 FROM hms.patient_owners o WHERE o.patient_id = p.id),
    'lastVisit', (SELECT max(s.starts_at) FROM hms.appointments a JOIN hms.appointment_slots s ON s.id = a.slot_id WHERE a.patient_id = p.id AND a.status IN ('completed', 'checked_in', 'in_consultation')),
    'visits', (SELECT count(*) FROM hms.appointments a WHERE a.patient_id = p.id AND a.status IN ('completed', 'checked_in', 'in_consultation')))
  FROM hms.patients p WHERE p.id = p_id $$;

CREATE FUNCTION hms_private.v7_resolve(p_org uuid, p_mrn text) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE pid uuid; nxt uuid; hops integer := 0;
BEGIN
  SELECT id INTO pid FROM hms.patients WHERE organization_id = p_org AND upper(mrn) = upper(trim(p_mrn));
  IF pid IS NULL THEN
    SELECT patient_id INTO pid FROM hms.patient_uhid_aliases WHERE organization_id = p_org AND upper(mrn) = upper(trim(p_mrn));
  END IF;
  LOOP
    SELECT merged_into INTO nxt FROM hms.patients WHERE id = pid;
    EXIT WHEN nxt IS NULL OR hops > 10;
    pid := nxt; hops := hops + 1;
  END LOOP;
  RETURN pid;
END $$;

-- ------------------------------------------------------------------ registration
CREATE FUNCTION public.hms_v7_duplicate_check(p_org uuid, p_branch uuid, p_name text, p_birth date, p_phone text, p_gender text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT hms_private.staff_permission(p_org, p_branch, 'patients.register') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  PERFORM hms_private.v3_audit(p_org, p_branch, 'patient.duplicate_check', 'branch', p_branch);
  RETURN (SELECT coalesce(jsonb_agg(hms_private.v7_summary(c.patient_id, p_branch) || jsonb_build_object('level', c.level)
            ORDER BY (c.level = 'likely') DESC), '[]'::jsonb)
          FROM (SELECT * FROM hms_private.v7_candidates(p_org, p_name, p_birth, p_phone, p_gender, NULL) LIMIT 10) c);
END $$;

CREATE FUNCTION public.hms_v7_register(p_org uuid, p_branch uuid, p_name text, p_birth date, p_phone text, p_gender text, p_notice text, p_override text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid uuid; c record; n integer := 0;
BEGIN
  IF NOT hms_private.staff_permission(p_org, p_branch, 'patients.register') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 2 AND 100 OR p_notice IS NULL OR length(p_notice) NOT BETWEEN 1 AND 50
     OR (p_phone IS NOT NULL AND p_phone !~ '^\+[1-9][0-9]{7,14}$') OR p_birth > current_date
     OR (p_gender IS NOT NULL AND p_gender NOT IN ('female', 'male', 'other'))
     OR (p_override IS NOT NULL AND length(trim(p_override)) NOT BETWEEN 5 AND 300)
  THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text || ':register', 0));
  SELECT count(*) INTO n FROM hms_private.v7_candidates(p_org, p_name, p_birth, p_phone, p_gender, NULL);
  IF n > 0 AND p_override IS NULL THEN RAISE EXCEPTION 'POSSIBLE_DUPLICATE'; END IF;
  INSERT INTO hms.patients (organization_id, mrn, full_name, birth_date, gender)
    VALUES (p_org, 'MRN-' || upper(replace(gen_random_uuid()::text, '-', '')), trim(p_name), p_birth, p_gender) RETURNING id INTO pid;
  INSERT INTO hms.patient_branches VALUES (p_org, pid, p_branch);
  IF p_phone IS NOT NULL THEN INSERT INTO hms.patient_contacts (organization_id, patient_id, kind, contact_value) VALUES (p_org, pid, 'phone', p_phone); END IF;
  INSERT INTO hms.consent_records (organization_id, patient_id, purpose, notice_version, status, recorded_by)
    VALUES (p_org, pid, 'registration', p_notice, 'granted', auth.uid());
  -- Registering despite matches: keep the decision and its reason with each candidate.
  FOR c IN SELECT * FROM hms_private.v7_candidates(p_org, p_name, p_birth, p_phone, p_gender, pid) LOOP
    INSERT INTO hms.patient_duplicate_flags (organization_id, branch_id, patient_id, candidate_id, level, source, status, created_by, resolved_by, resolved_at, resolution_note)
      VALUES (p_org, p_branch, pid, c.patient_id, c.level, 'registration', 'dismissed', auth.uid(), auth.uid(), now(), trim(p_override));
  END LOOP;
  PERFORM hms_private.v3_audit(p_org, p_branch, CASE WHEN n > 0 THEN 'patient.register.override' ELSE 'patient.register' END, 'patient', pid);
  RETURN pid;
END $$;

-- ------------------------------------------------------------------ online booking (date of birth required)
CREATE FUNCTION public.hms_v7_book_self(p_slug text, p_branch text, p_slot uuid, p_name text, p_payment text, p_request uuid,
    p_notice text, p_adult boolean, p_expected_fee bigint, p_policy_version integer, p_birth date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; pat hms.patients%ROWTYPE; br uuid; c record; ph text;
BEGIN
  IF p_birth IS NULL OR p_birth > current_date OR p_birth < date '1900-01-01' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF p_birth > (current_date - interval '18 years')::date THEN RAISE EXCEPTION 'ADULT_REQUIRED'; END IF;
  r := public.hms_v4_book_self(p_slug, p_branch, p_slot, p_name, p_payment, p_request, p_notice, p_adult, p_expected_fee, p_policy_version);
  SELECT p.* INTO pat FROM hms.appointments a JOIN hms.patients p ON p.id = a.patient_id WHERE a.id = (r->>'id')::uuid;
  SELECT a.branch_id INTO br FROM hms.appointments a WHERE a.id = (r->>'id')::uuid;
  IF pat.birth_date IS NULL THEN
    UPDATE hms.patients SET birth_date = p_birth, updated_at = now() WHERE id = pat.id;
  END IF;
  -- A record created by this booking is checked against existing ones and flagged for reception.
  IF pat.created_at = now() THEN
    SELECT contact_value INTO ph FROM hms.patient_contacts WHERE patient_id = pat.id AND kind = 'phone' LIMIT 1;
    FOR c IN SELECT * FROM hms_private.v7_candidates(pat.organization_id, pat.full_name, p_birth, ph, pat.gender, pat.id) LOOP
      INSERT INTO hms.patient_duplicate_flags (organization_id, branch_id, patient_id, candidate_id, level, source)
        VALUES (pat.organization_id, br, pat.id, c.patient_id, c.level, 'online_booking') ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  RETURN r;
END $$;

-- ------------------------------------------------------------------ review queue
CREATE FUNCTION public.hms_v7_duplicates(p_org uuid, p_branch uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (hms_private.staff_permission(p_org, p_branch, 'patients.demographics.read') AND
          (hms_private.staff_permission(p_org, p_branch, 'patients.register') OR hms_private.staff_permission(p_org, p_branch, 'settings.manage')))
  THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM hms_private.v3_audit(p_org, p_branch, 'patient.duplicates.read', 'branch', p_branch);
  RETURN (SELECT coalesce(jsonb_agg(q ORDER BY q->>'createdAt'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('id', f.id, 'level', f.level, 'source', f.source, 'createdAt', f.created_at,
      'patient', hms_private.v7_summary(f.patient_id, p_branch), 'candidate', hms_private.v7_summary(f.candidate_id, p_branch),
      'mergePending', EXISTS (SELECT 1 FROM hms.patient_merges m WHERE m.status = 'pending' AND (m.survivor_id IN (f.patient_id, f.candidate_id) OR m.merged_id IN (f.patient_id, f.candidate_id)))) q
    FROM hms.patient_duplicate_flags f
    JOIN hms.patients p1 ON p1.id = f.patient_id AND p1.merged_into IS NULL
    JOIN hms.patients p2 ON p2.id = f.candidate_id AND p2.merged_into IS NULL
    WHERE f.organization_id = p_org AND f.branch_id = p_branch AND f.status = 'open'
    LIMIT 200) z);
END $$;

-- Check one existing patient against the rest (from the patient record); opens flags for review.
CREATE FUNCTION public.hms_v7_patient_candidates(p_org uuid, p_branch uuid, p_patient uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p hms.patients%ROWTYPE; ph text; c record;
BEGIN
  IF NOT (hms_private.staff_permission(p_org, p_branch, 'patients.demographics.read') AND
          (hms_private.staff_permission(p_org, p_branch, 'patients.register') OR hms_private.staff_permission(p_org, p_branch, 'settings.manage')))
  THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT x.* INTO p FROM hms.patients x JOIN hms.patient_branches b ON b.patient_id = x.id AND b.branch_id = p_branch
    WHERE x.id = p_patient AND x.organization_id = p_org AND x.merged_into IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT contact_value INTO ph FROM hms.patient_contacts WHERE patient_id = p.id AND kind = 'phone' ORDER BY verified_at DESC NULLS LAST LIMIT 1;
  FOR c IN SELECT * FROM hms_private.v7_candidates(p_org, p.full_name, p.birth_date, ph, p.gender, p.id) LOOP
    INSERT INTO hms.patient_duplicate_flags (organization_id, branch_id, patient_id, candidate_id, level, source, created_by)
      VALUES (p_org, p_branch, p.id, c.patient_id, c.level, 'review', auth.uid()) ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM hms_private.v3_audit(p_org, p_branch, 'patient.duplicate_check', 'patient', p.id);
  RETURN (SELECT coalesce(jsonb_agg(hms_private.v7_summary(c2.patient_id, p_branch) || jsonb_build_object('level', c2.level)), '[]'::jsonb)
          FROM hms_private.v7_candidates(p_org, p.full_name, p.birth_date, ph, p.gender, p.id) c2);
END $$;

CREATE FUNCTION public.hms_v7_flag_dismiss(p_flag uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f hms.patient_duplicate_flags%ROWTYPE;
BEGIN
  SELECT * INTO f FROM hms.patient_duplicate_flags WHERE id = p_flag FOR UPDATE;
  IF NOT FOUND OR NOT (hms_private.staff_permission(f.organization_id, f.branch_id, 'patients.register')
                      OR hms_private.staff_permission(f.organization_id, f.branch_id, 'settings.manage'))
  THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_note IS NULL OR length(trim(p_note)) NOT BETWEEN 5 AND 300 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF f.status <> 'open' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  UPDATE hms.patient_duplicate_flags SET status = 'dismissed', resolved_by = auth.uid(), resolved_at = now(), resolution_note = trim(p_note) WHERE id = f.id;
  PERFORM hms_private.v3_audit(f.organization_id, f.branch_id, 'patient.duplicate.dismissed', 'patient', f.patient_id);
  RETURN jsonb_build_object('status', 'dismissed');
END $$;

-- ------------------------------------------------------------------ merge
CREATE FUNCTION public.hms_v7_merge_propose(p_org uuid, p_branch uuid, p_a uuid, p_b uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a hms.patients%ROWTYPE; b hms.patients%ROWTYPE; s uuid; m uuid; mid uuid;
BEGIN
  IF NOT (hms_private.staff_permission(p_org, p_branch, 'patients.demographics.read') AND
          (hms_private.staff_permission(p_org, p_branch, 'patients.register') OR hms_private.staff_permission(p_org, p_branch, 'settings.manage')))
  THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_a IS NULL OR p_b IS NULL OR p_a = p_b OR length(coalesce(p_note, '')) > 500 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  SELECT * INTO a FROM hms.patients WHERE id = p_a AND organization_id = p_org AND merged_into IS NULL;
  SELECT * INTO b FROM hms.patients WHERE id = p_b AND organization_id = p_org AND merged_into IS NULL;
  IF a.id IS NULL OR b.id IS NULL
     OR NOT EXISTS (SELECT 1 FROM hms.patient_branches WHERE patient_id = a.id AND branch_id = p_branch)
     OR NOT EXISTS (SELECT 1 FROM hms.patient_branches WHERE patient_id = b.id AND branch_id = p_branch)
  THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF EXISTS (SELECT 1 FROM hms.patient_owners WHERE patient_id = a.id) AND EXISTS (SELECT 1 FROM hms.patient_owners WHERE patient_id = b.id)
  THEN RAISE EXCEPTION 'BOTH_HAVE_ACCOUNTS'; END IF;
  -- The first-registered UHID always survives.
  IF (a.created_at, a.mrn) <= (b.created_at, b.mrn) THEN s := a.id; m := b.id; ELSE s := b.id; m := a.id; END IF;
  IF EXISTS (SELECT 1 FROM hms.patient_merges WHERE status = 'pending' AND (survivor_id IN (s, m) OR merged_id IN (s, m)))
  THEN RAISE EXCEPTION 'MERGE_PENDING'; END IF;
  INSERT INTO hms.patient_merges (organization_id, branch_id, survivor_id, merged_id, proposed_by, proposal_note)
    VALUES (p_org, p_branch, s, m, auth.uid(), nullif(trim(coalesce(p_note, '')), '')) RETURNING id INTO mid;
  PERFORM hms_private.v3_audit(p_org, p_branch, 'patient.merge.proposed', 'patient', s);
  RETURN jsonb_build_object('mergeId', mid, 'survivor', hms_private.v7_summary(s, p_branch), 'merged', hms_private.v7_summary(m, p_branch));
END $$;

CREATE FUNCTION public.hms_v7_merges(p_org uuid, p_branch uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE undo_days integer;
BEGIN
  IF NOT (hms_private.staff_permission(p_org, p_branch, 'patients.demographics.read') AND
          (hms_private.staff_permission(p_org, p_branch, 'patients.register') OR hms_private.staff_permission(p_org, p_branch, 'settings.manage')))
  THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT merge_undo_days INTO undo_days FROM hms.hospital_settings WHERE organization_id = p_org AND branch_id = p_branch;
  PERFORM hms_private.v3_audit(p_org, p_branch, 'patient.merges.read', 'branch', p_branch);
  RETURN jsonb_build_object(
    'undoDays', undo_days,
    'pending', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'proposedAt', m.proposed_at, 'note', m.proposal_note,
        'proposedBy', coalesce((SELECT display_name FROM hms.profiles WHERE user_id = m.proposed_by), 'Staff member'),
        'mine', m.proposed_by = auth.uid(),
        'survivor', hms_private.v7_summary(m.survivor_id, p_branch), 'merged', hms_private.v7_summary(m.merged_id, p_branch)) ORDER BY m.proposed_at)
      FROM hms.patient_merges m WHERE m.organization_id = p_org AND m.branch_id = p_branch AND m.status = 'pending'), '[]'::jsonb),
    'recent', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'status', m.status, 'decidedAt', m.decided_at,
        'survivorMrn', s.mrn, 'survivorName', s.full_name, 'mergedMrn', x.mrn, 'idCheck', m.id_check_type,
        'canUndo', m.status = 'approved' AND (undo_days IS NULL OR m.decided_at > now() - make_interval(days => undo_days))) ORDER BY m.decided_at DESC)
      FROM (SELECT * FROM hms.patient_merges WHERE organization_id = p_org AND branch_id = p_branch AND status IN ('approved', 'undone')
            ORDER BY decided_at DESC LIMIT 50) m
      JOIN hms.patients s ON s.id = m.survivor_id JOIN hms.patients x ON x.id = m.merged_id), '[]'::jsonb));
END $$;

CREATE FUNCTION public.hms_v7_merge_cancel(p_merge uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m hms.patient_merges%ROWTYPE;
BEGIN
  SELECT * INTO m FROM hms.patient_merges WHERE id = p_merge FOR UPDATE;
  IF NOT FOUND OR m.proposed_by IS DISTINCT FROM auth.uid() OR NOT hms_private.staff_permission(m.organization_id, m.branch_id, 'patients.demographics.read')
  THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF m.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  UPDATE hms.patient_merges SET status = 'cancelled' WHERE id = m.id;
  PERFORM hms_private.v3_audit(m.organization_id, m.branch_id, 'patient.merge.cancelled', 'patient', m.survivor_id);
  RETURN jsonb_build_object('status', 'cancelled');
END $$;

CREATE FUNCTION hms_private.v7_log(p_merge uuid, p_table text, p_key jsonb, p_action text) RETURNS void
LANGUAGE sql SET search_path = '' AS $$
  INSERT INTO hms.patient_merge_moves (merge_id, table_name, row_key, action) VALUES (p_merge, p_table, p_key, p_action) $$;

CREATE FUNCTION public.hms_v7_merge_decide(p_merge uuid, p_approve boolean, p_id_check text, p_choices jsonb, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m hms.patient_merges%ROWTYPE; s hms.patients%ROWTYPE; x hms.patients%ROWTYPE; k text; rid uuid; br uuid; ch text; usr uuid;
  new_name text; new_birth date; new_gender text;
BEGIN
  SELECT * INTO m FROM hms.patient_merges WHERE id = p_merge;
  IF NOT FOUND OR NOT hms_private.staff_permission(m.organization_id, m.branch_id, 'settings.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF m.proposed_by = auth.uid() THEN RAISE EXCEPTION 'SECOND_PERSON_REQUIRED'; END IF;
  IF p_approve IS NULL OR length(coalesce(p_note, '')) > 500 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF NOT p_approve AND nullif(trim(coalesce(p_note, '')), '') IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF p_approve AND (p_id_check IS NULL OR p_id_check NOT IN ('aadhaar', 'pan', 'passport', 'driving_licence', 'voter_id', 'other_government_id'))
  THEN RAISE EXCEPTION 'ID_CHECK_REQUIRED'; END IF;
  IF p_choices IS NOT NULL AND (jsonb_typeof(p_choices) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_each_text(p_choices) e WHERE e.key NOT IN ('name', 'birthDate', 'gender') OR e.value NOT IN ('survivor', 'merged')))
  THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  -- Lock both patients (stable order), then the merge row.
  PERFORM 1 FROM hms.patients WHERE id IN (m.survivor_id, m.merged_id) ORDER BY id FOR UPDATE;
  SELECT * INTO m FROM hms.patient_merges WHERE id = p_merge FOR UPDATE;
  IF m.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;

  IF NOT p_approve THEN
    UPDATE hms.patient_merges SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) WHERE id = m.id;
    PERFORM hms_private.v3_audit(m.organization_id, m.branch_id, 'patient.merge.rejected', 'patient', m.survivor_id);
    RETURN jsonb_build_object('status', 'rejected');
  END IF;

  SELECT * INTO s FROM hms.patients WHERE id = m.survivor_id;
  SELECT * INTO x FROM hms.patients WHERE id = m.merged_id;
  IF s.merged_into IS NOT NULL OR x.merged_into IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF EXISTS (SELECT 1 FROM hms.patient_owners WHERE patient_id = s.id) AND EXISTS (SELECT 1 FROM hms.patient_owners WHERE patient_id = x.id)
  THEN RAISE EXCEPTION 'BOTH_HAVE_ACCOUNTS'; END IF;

  -- 1. Branch registrations the survivor lacks.
  FOR br IN SELECT branch_id FROM hms.patient_branches WHERE patient_id = x.id
             AND branch_id NOT IN (SELECT branch_id FROM hms.patient_branches WHERE patient_id = s.id) LOOP
    INSERT INTO hms.patient_branches VALUES (s.organization_id, s.id, br);
    PERFORM hms_private.v7_log(m.id, 'patient_branches', jsonb_build_object('branch_id', br), 'inserted');
  END LOOP;
  -- 2. Appointments (encounters, prescriptions, vitals, notes follow through the cascading key).
  FOR rid IN UPDATE hms.appointments SET patient_id = s.id WHERE patient_id = x.id RETURNING id LOOP
    PERFORM hms_private.v7_log(m.id, 'appointments', jsonb_build_object('id', rid), 'moved');
  END LOOP;
  -- 3. Care assignments: an active one the survivor already has with the same doctor wins.
  FOR rid IN UPDATE hms.care_assignments ca SET revoked_at = now() WHERE ca.patient_id = x.id AND ca.revoked_at IS NULL
      AND EXISTS (SELECT 1 FROM hms.care_assignments o WHERE o.patient_id = s.id AND o.revoked_at IS NULL AND o.doctor_id = ca.doctor_id AND o.branch_id = ca.branch_id)
      RETURNING ca.id LOOP
    PERFORM hms_private.v7_log(m.id, 'care_assignments', jsonb_build_object('id', rid), 'revoked');
  END LOOP;
  FOR rid IN UPDATE hms.care_assignments SET patient_id = s.id WHERE patient_id = x.id RETURNING id LOOP
    PERFORM hms_private.v7_log(m.id, 'care_assignments', jsonb_build_object('id', rid), 'moved');
  END LOOP;
  -- 4. Documents, history, consents.
  FOR rid IN UPDATE hms.patient_documents SET patient_id = s.id WHERE patient_id = x.id RETURNING id LOOP
    PERFORM hms_private.v7_log(m.id, 'patient_documents', jsonb_build_object('id', rid), 'moved');
  END LOOP;
  FOR rid IN UPDATE hms.patient_history SET patient_id = s.id WHERE patient_id = x.id RETURNING id LOOP
    PERFORM hms_private.v7_log(m.id, 'patient_history', jsonb_build_object('id', rid), 'moved');
  END LOOP;
  FOR rid IN UPDATE hms.consent_records SET patient_id = s.id WHERE patient_id = x.id RETURNING id LOOP
    PERFORM hms_private.v7_log(m.id, 'consent_records', jsonb_build_object('id', rid), 'moved');
  END LOOP;
  -- 5. Contacts the survivor does not already have.
  FOR rid IN UPDATE hms.patient_contacts c SET patient_id = s.id WHERE c.patient_id = x.id
      AND NOT EXISTS (SELECT 1 FROM hms.patient_contacts o WHERE o.patient_id = s.id AND o.kind = c.kind
        AND coalesce(hms_private.v7_phone10(o.contact_value), lower(o.contact_value)) = coalesce(hms_private.v7_phone10(c.contact_value), lower(c.contact_value)))
      RETURNING c.id LOOP
    PERFORM hms_private.v7_log(m.id, 'patient_contacts', jsonb_build_object('id', rid), 'moved');
  END LOOP;
  -- 6. Online account link (at most one side has one).
  FOR usr IN UPDATE hms.patient_owners SET patient_id = s.id WHERE patient_id = x.id RETURNING user_id LOOP
    PERFORM hms_private.v7_log(m.id, 'patient_owners', jsonb_build_object('user_id', usr), 'moved');
  END LOOP;
  -- 7. Notification preferences for channels the survivor has not set.
  FOR ch IN UPDATE hms.notification_preferences np SET patient_id = s.id WHERE np.patient_id = x.id
      AND NOT EXISTS (SELECT 1 FROM hms.notification_preferences o WHERE o.patient_id = s.id AND o.channel = np.channel)
      RETURNING np.channel LOOP
    PERFORM hms_private.v7_log(m.id, 'notification_preferences', jsonb_build_object('channel', ch), 'moved');
  END LOOP;
  -- 8. Demographics chosen by the approver (previous values kept for undo).
  new_name := CASE WHEN p_choices->>'name' = 'merged' THEN x.full_name ELSE s.full_name END;
  new_birth := CASE WHEN p_choices->>'birthDate' = 'merged' THEN x.birth_date ELSE coalesce(s.birth_date, x.birth_date) END;
  new_gender := CASE WHEN p_choices->>'gender' = 'merged' THEN x.gender ELSE coalesce(s.gender, x.gender) END;
  UPDATE hms.patients SET full_name = new_name, birth_date = new_birth, gender = new_gender, updated_at = now() WHERE id = s.id;
  UPDATE hms.patients SET merged_into = s.id, merged_at = now(), updated_at = now() WHERE id = x.id;
  INSERT INTO hms.patient_uhid_aliases (organization_id, mrn, patient_id, merge_id) VALUES (x.organization_id, x.mrn, s.id, m.id);
  UPDATE hms.patient_duplicate_flags SET status = 'merged', resolved_by = auth.uid(), resolved_at = now()
    WHERE status = 'open' AND least(patient_id, candidate_id) = least(s.id, x.id) AND greatest(patient_id, candidate_id) = greatest(s.id, x.id);
  UPDATE hms.patient_merges SET status = 'approved', decided_by = auth.uid(), decided_at = now(),
      decision_note = nullif(trim(coalesce(p_note, '')), ''), id_check_type = p_id_check, field_choices = p_choices,
      previous_survivor = jsonb_build_object('full_name', s.full_name, 'birth_date', s.birth_date, 'gender', s.gender)
    WHERE id = m.id;
  PERFORM hms_private.v3_audit(m.organization_id, m.branch_id, 'patient.merge.approved', 'patient', s.id);
  RETURN jsonb_build_object('status', 'approved', 'survivor', hms_private.v7_summary(s.id, m.branch_id), 'aliasMrn', x.mrn);
END $$;

CREATE FUNCTION public.hms_v7_merge_undo(p_merge uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m hms.patient_merges%ROWTYPE; mv record; undo_days integer;
BEGIN
  SELECT * INTO m FROM hms.patient_merges WHERE id = p_merge;
  IF NOT FOUND OR NOT hms_private.staff_permission(m.organization_id, m.branch_id, 'settings.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_note IS NULL OR length(trim(p_note)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  PERFORM 1 FROM hms.patients WHERE id IN (m.survivor_id, m.merged_id) ORDER BY id FOR UPDATE;
  SELECT * INTO m FROM hms.patient_merges WHERE id = p_merge FOR UPDATE;
  IF m.status <> 'approved' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  SELECT merge_undo_days INTO undo_days FROM hms.hospital_settings WHERE organization_id = m.organization_id AND branch_id = m.branch_id;
  IF undo_days IS NOT NULL AND m.decided_at < now() - make_interval(days => undo_days) THEN RAISE EXCEPTION 'UNDO_WINDOW_CLOSED'; END IF;
  -- A later merge involving either patient must be undone first.
  IF EXISTS (SELECT 1 FROM hms.patient_merges o WHERE o.id <> m.id AND o.status = 'approved' AND o.decided_at > m.decided_at
             AND (o.survivor_id IN (m.survivor_id, m.merged_id) OR o.merged_id IN (m.survivor_id, m.merged_id)))
  THEN RAISE EXCEPTION 'UNDO_BLOCKED'; END IF;

  -- Reverse in the opposite order. Rows created after the merge stay with the survivor.
  FOR mv IN SELECT * FROM hms.patient_merge_moves WHERE merge_id = m.id ORDER BY seq DESC LOOP
    CASE mv.table_name
      WHEN 'appointments' THEN UPDATE hms.appointments SET patient_id = m.merged_id WHERE id = (mv.row_key->>'id')::uuid AND patient_id = m.survivor_id;
      WHEN 'care_assignments' THEN
        IF mv.action = 'moved' THEN UPDATE hms.care_assignments SET patient_id = m.merged_id WHERE id = (mv.row_key->>'id')::uuid AND patient_id = m.survivor_id;
        ELSE UPDATE hms.care_assignments SET revoked_at = NULL WHERE id = (mv.row_key->>'id')::uuid AND revoked_at IS NOT NULL; END IF;
      WHEN 'patient_documents' THEN UPDATE hms.patient_documents SET patient_id = m.merged_id WHERE id = (mv.row_key->>'id')::uuid AND patient_id = m.survivor_id;
      WHEN 'patient_history' THEN UPDATE hms.patient_history SET patient_id = m.merged_id WHERE id = (mv.row_key->>'id')::uuid AND patient_id = m.survivor_id;
      WHEN 'consent_records' THEN UPDATE hms.consent_records SET patient_id = m.merged_id WHERE id = (mv.row_key->>'id')::uuid AND patient_id = m.survivor_id;
      WHEN 'patient_contacts' THEN UPDATE hms.patient_contacts SET patient_id = m.merged_id WHERE id = (mv.row_key->>'id')::uuid AND patient_id = m.survivor_id;
      WHEN 'patient_owners' THEN UPDATE hms.patient_owners SET patient_id = m.merged_id WHERE user_id = (mv.row_key->>'user_id')::uuid AND patient_id = m.survivor_id;
      WHEN 'notification_preferences' THEN UPDATE hms.notification_preferences SET patient_id = m.merged_id
        WHERE patient_id = m.survivor_id AND channel = mv.row_key->>'channel'
          AND NOT EXISTS (SELECT 1 FROM hms.notification_preferences o WHERE o.patient_id = m.merged_id AND o.channel = mv.row_key->>'channel');
      WHEN 'patient_branches' THEN NULL; -- the survivor keeps the extra branch registration (harmless, may be in use)
      ELSE RAISE EXCEPTION 'UNDO_UNKNOWN_TABLE';
    END CASE;
  END LOOP;
  UPDATE hms.patients SET full_name = m.previous_survivor->>'full_name', birth_date = (m.previous_survivor->>'birth_date')::date,
      gender = m.previous_survivor->>'gender', updated_at = now() WHERE id = m.survivor_id;
  UPDATE hms.patients SET merged_into = NULL, merged_at = NULL, updated_at = now() WHERE id = m.merged_id;
  DELETE FROM hms.patient_uhid_aliases WHERE merge_id = m.id;
  UPDATE hms.patient_merges SET status = 'undone', undone_by = auth.uid(), undone_at = now(), undo_note = trim(p_note) WHERE id = m.id;
  PERFORM hms_private.v3_audit(m.organization_id, m.branch_id, 'patient.merge.undone', 'patient', m.survivor_id);
  RETURN jsonb_build_object('status', 'undone');
END $$;

-- ------------------------------------------------------------------ existing lookups follow merges
-- Staff patient search: merged records are hidden; their old UHID finds the surviving patient.
CREATE OR REPLACE FUNCTION public.hms_staff_patients(p_org uuid, p_branch uuid, p_search text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  all_pat boolean; assigned boolean;
  term text := nullif(trim(p_search), '');
  digits text := right(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), 10);
BEGIN
  all_pat := hms_private.staff_permission(p_org, p_branch, 'patients.demographics.read');
  assigned := hms_private.staff_permission(p_org, p_branch, 'patients.assigned.read');
  IF NOT (all_pat OR assigned) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF term IS NOT NULL AND length(term) > 100 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  PERFORM hms_private.v3_audit(p_org, p_branch, CASE WHEN term IS NULL THEN 'patient.list' ELSE 'patient.search' END, 'branch', p_branch);
  RETURN (
    SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
      SELECT jsonb_build_object('id', p.id, 'mrn', p.mrn, 'name', p.full_name, 'birthDate', p.birth_date) x
      FROM hms.patients p
      JOIN hms.patient_branches pb ON pb.organization_id = p.organization_id AND pb.patient_id = p.id AND pb.branch_id = p_branch
      WHERE p.organization_id = p_org AND p.merged_into IS NULL
        AND (all_pat OR hms_private.has_care_assignment(p_org, p_branch, p.id))
        AND (
          term IS NULL
          OR position(lower(term) IN lower(p.full_name || ' ' || p.mrn)) > 0
          OR EXISTS (SELECT 1 FROM hms.patient_uhid_aliases al WHERE al.organization_id = p_org AND al.patient_id = p.id AND upper(al.mrn) = upper(term))
          OR (length(digits) = 10 AND EXISTS (
                SELECT 1 FROM hms.patient_contacts c
                WHERE c.organization_id = p.organization_id AND c.patient_id = p.id AND c.kind = 'phone'
                  AND right(regexp_replace(c.contact_value, '\D', '', 'g'), 10) = digits))
          OR (upper(term) LIKE 'BK-%' AND EXISTS (
                SELECT 1 FROM hms.appointments a
                WHERE a.organization_id = p.organization_id AND a.patient_id = p.id AND a.branch_id = p_branch
                  AND upper(a.reference) = upper(term)))
        )
      ORDER BY p.created_at DESC
      LIMIT 100
    ) q
  );
END $$;

-- Doctor timeline: an old UHID resolves to the surviving record; flags a possible duplicate without
-- revealing anything about the other record.
CREATE OR REPLACE FUNCTION public.hms_v4_patient_timeline(p_org uuid, p_branch uuid, p_mrn text, p_offset integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE p hms.patients%ROWTYPE;
BEGIN
 IF p_offset<0 OR p_offset>100000 OR NOT hms_private.staff_permission(p_org,p_branch,'clinical.assigned.read') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO p FROM hms.patients x WHERE x.id=hms_private.v7_resolve(p_org,p_mrn) AND hms_private.has_care_assignment(p_org,p_branch,x.id);
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM hms_private.v3_audit(p_org,p_branch,'clinical.mrn.timeline.read','patient',p.id);
 RETURN jsonb_build_object('name',p.full_name,'mrn',p.mrn,'offset',p_offset,
 'formerUhids',coalesce((SELECT jsonb_agg(al.mrn ORDER BY al.created_at) FROM hms.patient_uhid_aliases al WHERE al.patient_id=p.id),'[]'::jsonb),
 'possibleDuplicate',EXISTS(SELECT 1 FROM hms.patient_duplicate_flags f WHERE f.status='open' AND p.id IN (f.patient_id,f.candidate_id)),
 'history',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT kind,detail,recorded_at FROM hms.patient_history WHERE organization_id=p_org AND branch_id=p_branch AND patient_id=p.id ORDER BY recorded_at DESC LIMIT 100) q),'[]'::jsonb),
 'visits',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT a.id,a.reference,a.status,s.starts_at,d.display_name doctor,e.status encounter_status,coalesce((SELECT n.body FROM hms.clinical_notes n WHERE n.encounter_id=e.id AND (n.signed_at IS NOT NULL OR hms_private.is_assigned_doctor(p_org,p_branch,a.doctor_id)) ORDER BY n.version DESC LIMIT 1),'') note,
 CASE WHEN e.status IN ('signed','amended') OR hms_private.is_assigned_doctor(p_org,p_branch,a.doctor_id) THEN coalesce((SELECT jsonb_agg(v.measurements ORDER BY v.recorded_at) FROM hms.vitals v WHERE v.encounter_id=e.id),'[]'::jsonb) ELSE '[]'::jsonb END vitals,
 CASE WHEN e.status IN ('signed','amended') OR hms_private.is_assigned_doctor(p_org,p_branch,a.doctor_id) THEN coalesce((SELECT jsonb_agg(dx.display_text) FROM hms.diagnoses dx WHERE dx.encounter_id=e.id),'[]'::jsonb) ELSE '[]'::jsonb END diagnoses,
 coalesce((SELECT jsonb_agg(hms_private.v3_rx_view(r.id) ORDER BY r.signed_at DESC) FROM hms.prescriptions r WHERE r.encounter_id=e.id AND r.status='signed'),'[]'::jsonb) prescriptions,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.document_id,'name',pd.original_name,'verifiedAt',x.verified_at,'uploadedAt',x.uploaded_at,'canVerify',hms_private.is_assigned_doctor(p_org,p_branch,a.doctor_id))) FROM hms.paper_prescription_archive x JOIN hms.patient_documents pd ON pd.id=x.document_id AND pd.scan_state='clean' WHERE x.appointment_id=a.id),'[]'::jsonb) paper
 FROM hms.appointments a JOIN hms.appointment_slots s ON s.id=a.slot_id JOIN hms.doctors d ON d.id=a.doctor_id LEFT JOIN hms.encounters e ON e.appointment_id=a.id WHERE a.organization_id=p_org AND a.branch_id=p_branch AND a.patient_id=p.id AND (a.status='completed' OR hms_private.is_assigned_doctor(p_org,p_branch,a.doctor_id)) ORDER BY s.starts_at DESC,a.id LIMIT 25 OFFSET p_offset) q),'[]'::jsonb));
END;$function$;

-- Reception prescription register: old UHID resolves to the surviving record.
DO $$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef('public.hms_v4_rx_register(uuid,uuid,text)'::regprocedure) INTO src;
  src := replace(src,
    'SELECT p.id INTO pid FROM hms.patients p JOIN hms.patient_branches b ON b.organization_id = p.organization_id AND b.patient_id = p.id
    WHERE p.organization_id = p_org AND b.branch_id = p_branch AND upper(p.mrn) = upper(trim(p_mrn));',
    'SELECT p.id INTO pid FROM hms.patients p JOIN hms.patient_branches b ON b.organization_id = p.organization_id AND b.patient_id = p.id
    WHERE p.organization_id = p_org AND b.branch_id = p_branch AND p.id = hms_private.v7_resolve(p_org, p_mrn);');
  IF position('v7_resolve' IN src) = 0 THEN RAISE EXCEPTION 'rx register lookup not patched'; END IF;
  EXECUTE src;
END $$;

-- Online booking now requires date of birth; the old entry point is closed to browsers.
REVOKE EXECUTE ON FUNCTION public.hms_v4_book_self(text, text, uuid, text, text, uuid, text, boolean, bigint, integer) FROM authenticated;
-- Registration must go through the duplicate check.
REVOKE EXECUTE ON FUNCTION public.hms_staff_register(uuid, uuid, text, text, date, text) FROM authenticated;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hms_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hms_v7_duplicate_check(uuid, uuid, text, date, text, text),
  public.hms_v7_register(uuid, uuid, text, date, text, text, text, text),
  public.hms_v7_book_self(text, text, uuid, text, text, uuid, text, boolean, bigint, integer, date),
  public.hms_v7_duplicates(uuid, uuid), public.hms_v7_patient_candidates(uuid, uuid, uuid), public.hms_v7_flag_dismiss(uuid, text),
  public.hms_v7_merge_propose(uuid, uuid, uuid, uuid, text), public.hms_v7_merges(uuid, uuid), public.hms_v7_merge_cancel(uuid),
  public.hms_v7_merge_decide(uuid, boolean, text, jsonb, text), public.hms_v7_merge_undo(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hms_v7_duplicate_check(uuid, uuid, text, date, text, text),
  public.hms_v7_register(uuid, uuid, text, date, text, text, text, text),
  public.hms_v7_book_self(text, text, uuid, text, text, uuid, text, boolean, bigint, integer, date),
  public.hms_v7_duplicates(uuid, uuid), public.hms_v7_patient_candidates(uuid, uuid, uuid), public.hms_v7_flag_dismiss(uuid, text),
  public.hms_v7_merge_propose(uuid, uuid, uuid, uuid, text), public.hms_v7_merges(uuid, uuid), public.hms_v7_merge_cancel(uuid),
  public.hms_v7_merge_decide(uuid, boolean, text, jsonb, text), public.hms_v7_merge_undo(uuid, text)
  TO authenticated;
COMMIT;
