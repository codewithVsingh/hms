BEGIN;
-- Clinical additions are isolated from administrative access. No direct table grants.
ALTER TABLE hms.prescriptions ADD COLUMN issued_by uuid REFERENCES auth.users(id), ADD COLUMN follow_up_on date, ADD COLUMN release_to_patient boolean NOT NULL DEFAULT false, ADD COLUMN doctor_name_snapshot text, ADD COLUMN registration_snapshot text, ADD COLUMN patient_name_snapshot text, ADD COLUMN patient_mrn_snapshot text;
CREATE TABLE hms.patient_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, patient_id uuid NOT NULL, branch_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('allergy','condition','history')), detail text NOT NULL CHECK(length(detail) BETWEEN 1 AND 1000),
 recorded_by uuid NOT NULL REFERENCES auth.users(id), recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,patient_id,branch_id) REFERENCES hms.patient_branches(organization_id,patient_id,branch_id)
);
ALTER TABLE hms.patient_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hms.patient_history FROM PUBLIC,anon,authenticated;
CREATE FUNCTION hms_private.v3_audit(p_org uuid,p_branch uuid,p_action text,p_type text,p_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(p_org,p_branch,auth.uid(),p_action,p_type,p_id,'success');
$$;
CREATE FUNCTION hms_private.v3_clinical_access(p_id uuid,p_write boolean) RETURNS hms.appointments LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE;
BEGIN
 SELECT * INTO a FROM hms.appointments WHERE id=p_id;
 IF NOT FOUND OR NOT hms_private.staff_permission(a.organization_id,a.branch_id,CASE WHEN p_write THEN 'clinical.assigned.write' ELSE 'clinical.assigned.read' END) OR NOT hms_private.is_assigned_doctor(a.organization_id,a.branch_id,a.doctor_id) OR NOT hms_private.has_care_assignment(a.organization_id,a.branch_id,a.patient_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN a;
END;$$;
CREATE FUNCTION hms_private.v3_rx_view(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',r.id,'version',r.version,'status',r.status,'issuedAt',r.signed_at,'doctor',coalesce(r.doctor_name_snapshot,d.display_name),'registration',coalesce(r.registration_snapshot,d.registration_number),'patient',coalesce(r.patient_name_snapshot,p.full_name),'mrn',coalesce(r.patient_mrn_snapshot,p.mrn),'followUp',r.follow_up_on,'released',r.release_to_patient,'items',coalesce((SELECT jsonb_agg(jsonb_build_object('medicine',i.medication_name,'dose',i.dose_text,'frequency',i.frequency_text,'duration',i.duration_text,'instructions',i.instructions) ORDER BY i.id) FROM hms.prescription_items i WHERE i.prescription_id=r.id),'[]'::jsonb))
 FROM hms.prescriptions r JOIN hms.encounters e ON e.id=r.encounter_id JOIN hms.doctors d ON d.id=e.doctor_id JOIN hms.patients p ON p.id=e.patient_id WHERE r.id=p_id;
$$;
CREATE FUNCTION public.hms_v3_care(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; p hms.patients%ROWTYPE;
BEGIN
 a:=hms_private.v3_clinical_access(p_id,false); SELECT * INTO p FROM hms.patients WHERE id=a.patient_id;
 PERFORM hms_private.v3_audit(a.organization_id,a.branch_id,'clinical.timeline.read','patient',p.id);
 RETURN jsonb_build_object('patient',p.full_name,'mrn',p.mrn,'status',a.status,'history',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT kind,detail,recorded_at FROM hms.patient_history WHERE organization_id=a.organization_id AND branch_id=a.branch_id AND patient_id=p.id ORDER BY recorded_at DESC LIMIT 100) q),'[]'::jsonb),
 'visits',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT ap.reference,ap.status,ap.created_at,coalesce((SELECT n.body FROM hms.clinical_notes n WHERE n.encounter_id=e.id ORDER BY n.version DESC LIMIT 1),'') note,coalesce((SELECT jsonb_agg(v.measurements ORDER BY v.recorded_at DESC) FROM hms.vitals v WHERE v.encounter_id=e.id),'[]'::jsonb) vitals,coalesce((SELECT jsonb_agg(d.display_text) FROM hms.diagnoses d WHERE d.encounter_id=e.id),'[]'::jsonb) diagnoses FROM hms.appointments ap JOIN hms.encounters e ON e.appointment_id=ap.id WHERE ap.organization_id=a.organization_id AND ap.branch_id=a.branch_id AND ap.patient_id=a.patient_id AND ap.doctor_id=a.doctor_id ORDER BY ap.created_at DESC LIMIT 30) q),'[]'::jsonb),
 'prescriptions',coalesce((SELECT jsonb_agg(hms_private.v3_rx_view(q.id)) FROM (SELECT r.id FROM hms.prescriptions r JOIN hms.encounters e ON e.id=r.encounter_id WHERE e.organization_id=a.organization_id AND e.branch_id=a.branch_id AND e.patient_id=a.patient_id AND e.doctor_id=a.doctor_id ORDER BY r.created_at DESC LIMIT 30) q),'[]'::jsonb));
END;$$;
CREATE FUNCTION public.hms_v3_record(p_id uuid,p_kind text,p_data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; eid uuid; detail text; kv record; val numeric;
BEGIN
 a:=hms_private.v3_clinical_access(p_id,true); PERFORM 1 FROM hms.appointments WHERE id=p_id FOR UPDATE; a:=hms_private.v3_clinical_access(p_id,true);
 IF a.status<>'in_consultation' OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
 INSERT INTO hms.encounters(organization_id,branch_id,appointment_id,patient_id,doctor_id) VALUES(a.organization_id,a.branch_id,a.id,a.patient_id,a.doctor_id) ON CONFLICT(organization_id,appointment_id) DO NOTHING;
 SELECT id INTO eid FROM hms.encounters WHERE appointment_id=a.id AND status='draft' FOR UPDATE;
 IF eid IS NULL THEN RAISE EXCEPTION 'SIGNED_RECORD'; END IF;
 IF p_kind='vitals' THEN
  IF p_data='{}'::jsonb THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  FOR kv IN SELECT * FROM jsonb_each(p_data) LOOP
   IF kv.key NOT IN ('pulse','systolic','diastolic','temperatureC','spo2','weightKg','heightCm') OR jsonb_typeof(kv.value)<>'number' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
   val:=(kv.value#>>'{}')::numeric;
   IF val<=0 OR val>500 OR (kv.key='spo2' AND val>100) OR (kv.key='temperatureC' AND val>50) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  END LOOP;
  INSERT INTO hms.vitals(organization_id,encounter_id,measurements,recorded_by) VALUES(a.organization_id,eid,p_data,auth.uid());
 ELSIF p_kind='diagnosis' THEN
  detail:=trim(p_data->>'detail'); IF detail IS NULL OR length(detail) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  INSERT INTO hms.diagnoses(organization_id,encounter_id,display_text) VALUES(a.organization_id,eid,detail);
 ELSIF p_kind IN ('allergy','condition','history') THEN
  detail:=trim(p_data->>'detail'); IF detail IS NULL OR length(detail) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  INSERT INTO hms.patient_history(organization_id,patient_id,branch_id,kind,detail,recorded_by) VALUES(a.organization_id,a.patient_id,a.branch_id,p_kind,detail,auth.uid());
 ELSE RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 PERFORM hms_private.v3_audit(a.organization_id,a.branch_id,'clinical.'||p_kind||'.add','encounter',eid);
END;$$;
CREATE FUNCTION public.hms_v3_issue_rx(p_id uuid,p_items jsonb,p_follow date,p_release boolean,p_attest boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; d hms.doctors%ROWTYPE; p hms.patients%ROWTYPE; eid uuid; rid uuid; ver integer; item jsonb;
BEGIN
 a:=hms_private.v3_clinical_access(p_id,true); PERFORM 1 FROM hms.appointments WHERE id=p_id FOR UPDATE; a:=hms_private.v3_clinical_access(p_id,true);
 IF a.status<>'in_consultation' OR NOT hms_private.staff_permission(a.organization_id,a.branch_id,'prescriptions.issue') OR p_attest IS DISTINCT FROM true OR p_release IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 25 OR (p_follow IS NOT NULL AND p_follow<current_date) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT * INTO d FROM hms.doctors WHERE id=a.doctor_id; SELECT * INTO p FROM hms.patients WHERE id=a.patient_id;
 IF nullif(trim(d.registration_number),'') IS NULL THEN RAISE EXCEPTION 'REGISTRATION_REQUIRED'; END IF;
 INSERT INTO hms.encounters(organization_id,branch_id,appointment_id,patient_id,doctor_id) VALUES(a.organization_id,a.branch_id,a.id,a.patient_id,a.doctor_id) ON CONFLICT(organization_id,appointment_id) DO NOTHING;
 SELECT id INTO eid FROM hms.encounters WHERE appointment_id=a.id AND status='draft' FOR UPDATE;
 IF eid IS NULL THEN RAISE EXCEPTION 'SIGNED_RECORD'; END IF;
 IF EXISTS(SELECT 1 FROM hms.prescriptions WHERE encounter_id=eid AND status='signed') THEN RAISE EXCEPTION 'SIGNED_RECORD'; END IF;
 SELECT coalesce(max(version),0)+1 INTO ver FROM hms.prescriptions WHERE encounter_id=eid;
 INSERT INTO hms.prescriptions(organization_id,encounter_id,version,status,signed_at,issued_by,follow_up_on,release_to_patient,doctor_name_snapshot,registration_snapshot,patient_name_snapshot,patient_mrn_snapshot)
 VALUES(a.organization_id,eid,ver,'signed',now(),auth.uid(),p_follow,p_release,d.display_name,d.registration_number,p.full_name,p.mrn) RETURNING id INTO rid;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF coalesce(length(trim(item->>'medicine')),0) NOT BETWEEN 1 AND 180 OR coalesce(length(trim(item->>'dose')),0) NOT BETWEEN 1 AND 100 OR coalesce(length(trim(item->>'frequency')),0) NOT BETWEEN 1 AND 100 OR coalesce(length(trim(item->>'duration')),0) NOT BETWEEN 1 AND 100 OR length(coalesce(item->>'instructions',''))>500 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  INSERT INTO hms.prescription_items(organization_id,prescription_id,medication_name,dose_text,frequency_text,duration_text,instructions) VALUES(a.organization_id,rid,trim(item->>'medicine'),trim(item->>'dose'),trim(item->>'frequency'),trim(item->>'duration'),item->>'instructions');
 END LOOP;
 PERFORM hms_private.v3_audit(a.organization_id,a.branch_id,'prescription.attested','prescription',rid);
 RETURN hms_private.v3_rx_view(rid);
END;$$;
CREATE FUNCTION public.hms_v3_patient_records(p_slug text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; pid uuid;
BEGIN
 SELECT o.id,po.patient_id INTO org,pid FROM hms.organizations o JOIN hms.patient_owners po ON po.organization_id=o.id WHERE o.slug=p_slug AND o.active AND po.user_id=auth.uid();
 IF pid IS NULL THEN RETURN jsonb_build_object('profile',NULL,'prescriptions','[]'::jsonb,'invoices','[]'::jsonb); END IF;
 INSERT INTO hms.audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,result) VALUES(org,auth.uid(),'patient.self.records.read','patient',pid,'success');
 RETURN jsonb_build_object('profile',(SELECT jsonb_build_object('name',full_name,'mrn',mrn,'birthDate',birth_date) FROM hms.patients WHERE id=pid),
 'prescriptions',coalesce((SELECT jsonb_agg(hms_private.v3_rx_view(q.id)) FROM (SELECT r.id FROM hms.prescriptions r JOIN hms.encounters e ON e.id=r.encounter_id WHERE e.organization_id=org AND e.patient_id=pid AND r.status='signed' AND r.release_to_patient ORDER BY r.created_at DESC LIMIT 100) q),'[]'::jsonb),
 'invoices',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT i.invoice_number,i.status,i.total_paise,i.issued_at,a.reference FROM hms.invoices i JOIN hms.appointments a ON a.id=i.appointment_id WHERE a.organization_id=org AND a.patient_id=pid AND i.status<>'draft' ORDER BY i.created_at DESC LIMIT 100) q),'[]'::jsonb));
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hms_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hms_v3_care(uuid),public.hms_v3_record(uuid,text,jsonb),public.hms_v3_issue_rx(uuid,jsonb,date,boolean,boolean),public.hms_v3_patient_records(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hms_v3_care(uuid),public.hms_v3_record(uuid,text,jsonb),public.hms_v3_issue_rx(uuid,jsonb,date,boolean,boolean),public.hms_v3_patient_records(text) TO authenticated;
COMMIT;
