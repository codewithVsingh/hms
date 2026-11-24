BEGIN;
-- 020: patient search by phone and booking reference, and audit of every staff patient search.
-- Same permission rules and result shape as before (id, mrn, name, birthDate; max 100 rows):
--   * patients.demographics.read -> branch patients; patients.assigned.read -> assigned patients only.
-- Search now matches: name or UHID (substring, as before), mobile number (last 10 digits, exact),
-- or booking reference (exact, case-insensitive). The audit entry records that a search happened,
-- not the search text, so names and phone numbers do not end up in the audit log.
CREATE OR REPLACE FUNCTION public.hms_staff_patients(p_org uuid, p_branch uuid, p_search text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  all_pat boolean;
  assigned boolean;
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
      WHERE p.organization_id = p_org
        AND (all_pat OR hms_private.has_care_assignment(p_org, p_branch, p.id))
        AND (
          term IS NULL
          OR position(lower(term) IN lower(p.full_name || ' ' || p.mrn)) > 0
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
REVOKE ALL ON FUNCTION public.hms_staff_patients(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hms_staff_patients(uuid, uuid, text) TO authenticated;
COMMIT;
