BEGIN;
CREATE FUNCTION public.hms_v3_move_slots(p_id uuid,p_day date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; tz text;
BEGIN
 SELECT * INTO a FROM hms.appointments WHERE id=p_id;
 IF NOT FOUND OR NOT(coalesce(a.booking_user_id=auth.uid() AND a.source='online',false) OR hms_private.staff_permission(a.organization_id,a.branch_id,'appointments.create')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT timezone INTO tz FROM hms.branches WHERE id=a.branch_id;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'startsAt',s.starts_at) ORDER BY s.starts_at),'[]'::jsonb) FROM hms.appointment_slots s WHERE s.organization_id=a.organization_id AND s.branch_id=a.branch_id AND s.doctor_id=a.doctor_id AND s.id<>a.slot_id AND s.enabled AND s.starts_at>now() AND (s.starts_at AT TIME ZONE tz)::date=p_day AND p_day BETWEEN (now() AT TIME ZONE tz)::date AND (now() AT TIME ZONE tz)::date+30 AND NOT EXISTS(SELECT 1 FROM hms.appointments a2 WHERE a2.slot_id=s.id AND (a2.status IN ('confirmed','checked_in','in_consultation','completed','no_show') OR a2.status='held' AND a2.hold_expires_at>now())) AND NOT EXISTS(SELECT 1 FROM hms.doctor_leaves l WHERE l.organization_id=s.organization_id AND l.doctor_id=s.doctor_id AND tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(s.starts_at,s.ends_at,'[)')));
END;$$;
-- Demographic corrections do not modify identity links, verified contacts, or MRN.
CREATE FUNCTION public.hms_v3_patient_edit(p_org uuid,p_branch uuid,p_id uuid,p_name text,p_birth date,p_gender text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'patients.register') OR NOT EXISTS(SELECT 1 FROM hms.patient_branches WHERE organization_id=p_org AND branch_id=p_branch AND patient_id=p_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF length(trim(p_name)) NOT BETWEEN 2 AND 100 OR p_birth>current_date OR p_birth<current_date-interval '130 years' OR (p_gender IS NOT NULL AND p_gender NOT IN ('female','male','other','not_disclosed')) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 UPDATE hms.patients SET full_name=trim(p_name),birth_date=p_birth,gender=coalesce(p_gender,gender),updated_at=now() WHERE organization_id=p_org AND id=p_id;
 PERFORM hms_private.v3_audit(p_org,p_branch,'patient.demographics.edit','patient',p_id);
END;$$;
CREATE TABLE hms.public_inquiries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,branch_id uuid NOT NULL,full_name text NOT NULL CHECK(length(full_name) BETWEEN 2 AND 100),phone text NOT NULL CHECK(phone~'^\+[1-9][0-9]{7,14}$'),category text NOT NULL CHECK(category IN ('appointment','hours','billing','general')),state text NOT NULL DEFAULT 'new' CHECK(state IN ('new','contacted','closed')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(organization_id,branch_id) REFERENCES hms.branches(organization_id,id));
ALTER TABLE hms.public_inquiries ENABLE ROW LEVEL SECURITY; REVOKE ALL ON hms.public_inquiries FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.hms_v3_inquiry_submit(p_slug text,p_branch text,p_name text,p_phone text,p_category text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; br uuid; iid uuid;
BEGIN
 SELECT o.id,b.id INTO org,br FROM hms.organizations o JOIN hms.branches b ON b.organization_id=o.id WHERE o.slug=p_slug AND b.code=p_branch AND o.active AND b.active;
 IF br IS NULL THEN RAISE EXCEPTION 'CONFIGURATION_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||p_phone,0));
 IF (SELECT count(*) FROM hms.public_inquiries WHERE organization_id=org AND phone=p_phone AND created_at>now()-interval '1 day')>=3 THEN RAISE EXCEPTION 'BOOKING_LIMIT'; END IF;
 INSERT INTO hms.public_inquiries(organization_id,branch_id,full_name,phone,category) VALUES(org,br,trim(p_name),p_phone,p_category) RETURNING id INTO iid; RETURN iid;
END;$$;
CREATE FUNCTION public.hms_v3_inquiries(p_org uuid,p_branch uuid,p_id uuid DEFAULT NULL,p_state text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT(hms_private.staff_permission(p_org,p_branch,'appointments.create') OR hms_private.staff_permission(p_org,p_branch,'settings.manage')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_id IS NOT NULL THEN
  IF p_state NOT IN ('contacted','closed') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  UPDATE hms.public_inquiries SET state=p_state,updated_at=now() WHERE id=p_id AND organization_id=p_org AND branch_id=p_branch AND state<>'closed';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM hms_private.v3_audit(p_org,p_branch,'inquiry.status','inquiry',p_id);
 END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (SELECT id,full_name,phone,category,state,created_at FROM hms.public_inquiries WHERE organization_id=p_org AND branch_id=p_branch ORDER BY created_at DESC LIMIT 100) q);
END;$$;
REVOKE ALL ON FUNCTION public.hms_v3_move_slots(uuid,date),public.hms_v3_patient_edit(uuid,uuid,uuid,text,date,text),public.hms_v3_inquiry_submit(text,text,text,text,text),public.hms_v3_inquiries(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hms_v3_move_slots(uuid,date),public.hms_v3_patient_edit(uuid,uuid,uuid,text,date,text),public.hms_v3_inquiries(uuid,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hms_v3_inquiry_submit(text,text,text,text,text) TO service_role;
COMMIT;
