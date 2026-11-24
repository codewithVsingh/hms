BEGIN;
-- All staff RPCs require an active branch membership, explicit permission and AAL2.
CREATE FUNCTION hms_private.staff_permission(p_org uuid,p_branch uuid,p_permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((auth.jwt()->>'aal')='aal2',false) AND hms_private.has_permission(p_org,p_branch,p_permission);
$$;
CREATE FUNCTION public.hms_staff_context(p_slug text,p_branch text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('organizationId',o.id,'branchId',b.id,'name',p.display_name,'roles',jsonb_agg(DISTINCT ur.role_key),'permissions',(SELECT coalesce(jsonb_agg(DISTINCT rp.permission_key),'[]'::jsonb) FROM hms.user_roles u2 JOIN hms.role_permissions rp ON rp.role_key=u2.role_key WHERE u2.organization_id=o.id AND u2.branch_id=b.id AND u2.membership_id=m.id))
 FROM hms.organizations o JOIN hms.branches b ON b.organization_id=o.id AND b.active JOIN hms.memberships m ON m.organization_id=o.id AND m.active AND m.user_id=auth.uid() JOIN hms.profiles p ON p.user_id=m.user_id JOIN hms.user_roles ur ON ur.organization_id=o.id AND ur.branch_id=b.id AND ur.membership_id=m.id
 WHERE o.slug=p_slug AND o.active AND b.code=p_branch AND coalesce((auth.jwt()->>'aal')='aal2',false) GROUP BY o.id,b.id,p.display_name,m.id;
$$;
-- Explicit scope and authorization for every returned appointment. Billing staff receive financial identifiers, not clinical notes.
CREATE FUNCTION public.hms_staff_appointments(p_org uuid,p_branch uuid,p_date date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE all_apts boolean; assigned boolean; finance boolean; tz text;
BEGIN
 all_apts:=hms_private.staff_permission(p_org,p_branch,'appointments.read'); assigned:=hms_private.staff_permission(p_org,p_branch,'appointments.assigned.read'); finance:=hms_private.staff_permission(p_org,p_branch,'billing.read');
 IF NOT(all_apts OR assigned OR finance) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT timezone INTO tz FROM hms.branches WHERE id=p_branch AND organization_id=p_org;
 RETURN (SELECT coalesce(jsonb_agg(x ORDER BY x->>'startsAt'),'[]'::jsonb) FROM (SELECT jsonb_build_object('id',a.id,'reference',a.reference,'status',CASE WHEN a.status='held' AND a.hold_expires_at<=now() THEN 'expired' ELSE a.status END,'patient',CASE WHEN all_apts OR (assigned AND hms_private.is_assigned_doctor(p_org,p_branch,a.doctor_id)) THEN p.full_name ELSE NULL END,'patientId',CASE WHEN all_apts OR (assigned AND hms_private.is_assigned_doctor(p_org,p_branch,a.doctor_id)) THEN p.id ELSE NULL END,'doctor',d.display_name,'startsAt',s.starts_at,'feePaise',CASE WHEN finance THEN i.total_paise ELSE NULL END,'invoiceNumber',CASE WHEN finance THEN i.invoice_number ELSE NULL END,'paymentStatus',CASE WHEN finance THEN CASE WHEN po.status='reconciliation_required' THEN 'needs_review' WHEN i.status='settled' THEN 'paid' WHEN EXISTS(SELECT 1 FROM hms.payments rp WHERE rp.invoice_id=i.id AND rp.status='refunded') THEN 'refunded' WHEN i.status='void' THEN 'void' WHEN i.order_claim IS NOT NULL AND po.id IS NULL THEN 'order_pending_review' ELSE 'unpaid' END ELSE NULL END,'paymentChoice',CASE WHEN finance THEN a.payment_choice ELSE NULL END) x
 FROM hms.appointments a JOIN hms.patients p ON p.id=a.patient_id JOIN hms.doctors d ON d.id=a.doctor_id JOIN hms.appointment_slots s ON s.id=a.slot_id JOIN hms.invoices i ON i.appointment_id=a.id LEFT JOIN hms.payment_orders po ON po.invoice_id=i.id
 WHERE a.organization_id=p_org AND a.branch_id=p_branch AND (p_date IS NULL OR (s.starts_at AT TIME ZONE tz)::date=p_date) AND (all_apts OR finance OR (assigned AND hms_private.is_assigned_doctor(p_org,p_branch,a.doctor_id))) ORDER BY s.starts_at DESC LIMIT 200) q);
END; $$;
CREATE FUNCTION public.hms_staff_patients(p_org uuid,p_branch uuid,p_search text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE all_pat boolean; assigned boolean;
BEGIN
 all_pat:=hms_private.staff_permission(p_org,p_branch,'patients.demographics.read'); assigned:=hms_private.staff_permission(p_org,p_branch,'patients.assigned.read');
 IF NOT(all_pat OR assigned) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT jsonb_build_object('id',p.id,'mrn',p.mrn,'name',p.full_name,'birthDate',p.birth_date) x FROM hms.patients p JOIN hms.patient_branches pb ON pb.organization_id=p.organization_id AND pb.patient_id=p.id AND pb.branch_id=p_branch WHERE p.organization_id=p_org AND (all_pat OR hms_private.has_care_assignment(p_org,p_branch,p.id)) AND (p_search IS NULL OR position(lower(p_search) IN lower(p.full_name||' '||p.mrn))>0) ORDER BY p.created_at DESC LIMIT 100) q);
END; $$;
CREATE FUNCTION public.hms_staff_register(p_org uuid,p_branch uuid,p_name text,p_phone text,p_birth date,p_notice text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid;
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'patients.register') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 2 AND 100 OR p_notice IS NULL OR length(p_notice) NOT BETWEEN 1 AND 50 OR (p_phone IS NOT NULL AND p_phone !~ '^\+[1-9][0-9]{7,14}$') OR p_birth>current_date THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 INSERT INTO hms.patients(organization_id,mrn,full_name,birth_date) VALUES(p_org,'MRN-'||upper(replace(gen_random_uuid()::text,'-','')),trim(p_name),p_birth) RETURNING id INTO pid;
 INSERT INTO hms.patient_branches VALUES(p_org,pid,p_branch);
 IF p_phone IS NOT NULL THEN INSERT INTO hms.patient_contacts(organization_id,patient_id,kind,contact_value) VALUES(p_org,pid,'phone',p_phone); END IF;
 INSERT INTO hms.consent_records(organization_id,patient_id,purpose,notice_version,status,recorded_by) VALUES(p_org,pid,'registration',p_notice,'granted',auth.uid());
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(p_org,p_branch,auth.uid(),'patient.register','patient',pid,'success');
 RETURN pid;
END; $$;
CREATE FUNCTION public.hms_staff_book(p_slot uuid,p_patient uuid,p_request uuid,p_notice text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s hms.appointment_slots%ROWTYPE; aid uuid;
BEGIN
 SELECT * INTO s FROM hms.appointment_slots WHERE id=p_slot;
 IF NOT FOUND OR NOT hms_private.staff_permission(s.organization_id,s.branch_id,'appointments.create') OR NOT EXISTS(SELECT 1 FROM hms.patient_branches WHERE organization_id=s.organization_id AND branch_id=s.branch_id AND patient_id=p_patient) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_request IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 SELECT id INTO aid FROM hms.appointments WHERE booking_user_id=auth.uid() AND request_id=p_request AND organization_id=s.organization_id AND branch_id=s.branch_id AND source='staff';
 IF aid IS NULL THEN aid:=hms_private.create_appointment(p_slot,p_patient,auth.uid(),p_request,'hospital','staff',p_notice); END IF;
 RETURN hms_private.booking_view(aid);
END; $$;
CREATE FUNCTION public.hms_staff_slots(p_org uuid,p_branch uuid,p_date date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'appointments.create') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'doctor',d.display_name,'startsAt',s.starts_at) ORDER BY s.starts_at),'[]'::jsonb) FROM hms.appointment_slots s JOIN hms.branches b ON b.id=s.branch_id JOIN hms.doctors d ON d.id=s.doctor_id AND d.active JOIN hms.doctor_branches db ON db.organization_id=s.organization_id AND db.branch_id=s.branch_id AND db.doctor_id=d.id AND db.active WHERE s.organization_id=p_org AND s.branch_id=p_branch AND s.enabled AND s.starts_at>now() AND EXISTS(SELECT 1 FROM hms.doctor_schedules sc WHERE sc.organization_id=s.organization_id AND sc.branch_id=s.branch_id AND sc.doctor_id=s.doctor_id AND sc.active AND sc.weekday=extract(dow FROM s.starts_at AT TIME ZONE b.timezone) AND (s.starts_at AT TIME ZONE b.timezone)::time>=sc.start_local AND (s.ends_at AT TIME ZONE b.timezone)::time<=sc.end_local) AND (s.starts_at AT TIME ZONE b.timezone)::date=p_date AND NOT EXISTS(SELECT 1 FROM hms.appointments a WHERE a.slot_id=s.id AND (a.status IN ('confirmed','checked_in','in_consultation','completed','no_show') OR (a.status='held' AND a.hold_expires_at>now()))) AND NOT EXISTS(SELECT 1 FROM hms.doctor_leaves l WHERE l.organization_id=s.organization_id AND l.doctor_id=s.doctor_id AND tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(s.starts_at,s.ends_at,'[)')));
END; $$;
CREATE FUNCTION public.hms_change_status(p_id uuid,p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; allowed boolean:=false; old text;
BEGIN
 SELECT * INTO a FROM hms.appointments WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM 1 FROM hms.appointment_slots WHERE id=a.slot_id FOR UPDATE;
 SELECT * INTO a FROM hms.appointments WHERE id=p_id FOR UPDATE; old:=a.status;
 IF hms_private.staff_permission(a.organization_id,a.branch_id,'appointments.checkin') THEN allowed:=(old='confirmed' AND (p_status='checked_in' OR (p_status='no_show' AND EXISTS(SELECT 1 FROM hms.appointment_slots WHERE id=a.slot_id AND starts_at<=now())))); END IF;
 IF hms_private.staff_permission(a.organization_id,a.branch_id,'clinical.assigned.write') AND hms_private.is_assigned_doctor(a.organization_id,a.branch_id,a.doctor_id) THEN allowed:=allowed OR (old='checked_in' AND p_status='in_consultation') OR (old='in_consultation' AND p_status='completed'); END IF;
 IF NOT allowed THEN RAISE EXCEPTION 'FORBIDDEN_OR_INVALID_TRANSITION'; END IF;
 UPDATE hms.appointments SET status=p_status,updated_at=now() WHERE id=p_id;
 INSERT INTO hms.appointment_status_history(organization_id,appointment_id,from_status,to_status,actor_user_id) VALUES(a.organization_id,a.id,old,p_status,auth.uid());
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(a.organization_id,a.branch_id,auth.uid(),'appointment.'||p_status,'appointment',a.id,'success');
END; $$;
CREATE FUNCTION public.hms_collect_offline(p_id uuid,p_method text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; i hms.invoices%ROWTYPE;
BEGIN
 SELECT * INTO a FROM hms.appointments WHERE id=p_id;
 IF NOT FOUND OR NOT hms_private.staff_permission(a.organization_id,a.branch_id,'payments.collect') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_method IS NULL OR p_method NOT IN ('cash','upi_offline','card_offline','bank_transfer') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 PERFORM 1 FROM hms.appointment_slots WHERE id=a.slot_id FOR UPDATE;
 SELECT * INTO a FROM hms.appointments WHERE id=p_id FOR UPDATE;
 SELECT * INTO i FROM hms.invoices WHERE appointment_id=a.id FOR UPDATE;
 IF a.payment_choice<>'hospital' OR a.status NOT IN ('confirmed','checked_in','in_consultation','completed') OR i.status<>'issued' OR i.total_paise<=0 THEN RAISE EXCEPTION 'NOT_PAYABLE'; END IF;
 INSERT INTO hms.payments(organization_id,invoice_id,method,amount_paise,status,captured_at,received_by) VALUES(a.organization_id,i.id,p_method,i.total_paise,'captured',now(),auth.uid());
 UPDATE hms.invoices SET status='settled' WHERE id=i.id;
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(a.organization_id,a.branch_id,auth.uid(),'payment.offline_collect','invoice',i.id,'success');
END; $$;
CREATE FUNCTION public.hms_staff_generate(p_org uuid,p_branch uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tz text;
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'settings.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT timezone INTO tz FROM hms.branches WHERE id=p_branch AND organization_id=p_org;
 RETURN hms_private.generate_slots(p_org,p_branch,(now() AT TIME ZONE tz)::date,31);
END; $$;
CREATE FUNCTION public.hms_staff_audit(p_org uuid,p_branch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'audit.read') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY occurred_at DESC),'[]'::jsonb) FROM (SELECT action,resource_type,resource_id,result,occurred_at FROM hms.audit_logs WHERE organization_id=p_org AND branch_id=p_branch ORDER BY occurred_at DESC LIMIT 100) q);
END; $$;
CREATE FUNCTION public.hms_staff_team(p_org uuid,p_branch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'users.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (SELECT p.display_name,m.active,array_agg(ur.role_key ORDER BY ur.role_key) roles FROM hms.memberships m JOIN hms.profiles p ON p.user_id=m.user_id JOIN hms.user_roles ur ON ur.organization_id=m.organization_id AND ur.membership_id=m.id AND ur.branch_id=p_branch WHERE m.organization_id=p_org GROUP BY m.id,p.display_name,m.active) q);
END; $$;
CREATE FUNCTION public.hms_cancel_self(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; i hms.invoices%ROWTYPE; old text;
BEGIN
 SELECT * INTO a FROM hms.appointments WHERE id=p_id AND booking_user_id=auth.uid() AND source='online';
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM 1 FROM hms.appointment_slots WHERE id=a.slot_id FOR UPDATE;
 SELECT * INTO a FROM hms.appointments WHERE id=p_id FOR UPDATE; old:=a.status;
 SELECT * INTO i FROM hms.invoices WHERE appointment_id=a.id FOR UPDATE;
 -- Only unpaid future visits can be cancelled automatically; paid/uncertain captures require reconciliation.
 IF old='cancelled' THEN RETURN hms_private.booking_view(a.id); END IF;
 IF old NOT IN ('held','confirmed') OR NOT EXISTS(SELECT 1 FROM hms.appointment_slots WHERE id=a.slot_id AND starts_at>now()) OR i.status='settled' AND i.total_paise>0 OR i.order_claim IS NOT NULL THEN RAISE EXCEPTION 'CONTACT_HOSPITAL_FOR_CANCELLATION'; END IF;
 UPDATE hms.appointments SET status='cancelled',updated_at=now() WHERE id=a.id;
 UPDATE hms.invoices SET status='void' WHERE id=i.id;
 UPDATE hms.care_assignments ca SET revoked_at=now() WHERE ca.organization_id=a.organization_id AND ca.branch_id=a.branch_id AND ca.patient_id=a.patient_id AND ca.doctor_id=a.doctor_id AND ca.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM hms.appointments a2 WHERE a2.id<>a.id AND a2.organization_id=a.organization_id AND a2.branch_id=a.branch_id AND a2.patient_id=a.patient_id AND a2.doctor_id=a.doctor_id AND a2.status IN ('confirmed','checked_in','in_consultation','completed'));
 INSERT INTO hms.appointment_status_history(organization_id,appointment_id,from_status,to_status,actor_user_id) VALUES(a.organization_id,a.id,old,'cancelled',auth.uid());
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(a.organization_id,a.branch_id,auth.uid(),'appointment.cancel','appointment',a.id,'success');
 RETURN hms_private.booking_view(a.id);
END; $$;
-- Consultation draft persistence, assigned clinician only. No prescription issuing or signature workflow yet.
CREATE FUNCTION public.hms_clinical_draft(p_id uuid,p_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; e uuid; v integer; n text;
BEGIN
 SELECT * INTO a FROM hms.appointments WHERE id=p_id;
 IF NOT FOUND OR NOT hms_private.staff_permission(a.organization_id,a.branch_id,'clinical.assigned.write') OR NOT hms_private.is_assigned_doctor(a.organization_id,a.branch_id,a.doctor_id) OR NOT hms_private.has_care_assignment(a.organization_id,a.branch_id,a.patient_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM 1 FROM hms.appointments WHERE id=p_id FOR UPDATE;
 SELECT * INTO a FROM hms.appointments WHERE id=p_id;
 IF a.status NOT IN ('in_consultation','completed') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
 SELECT id INTO e FROM hms.encounters WHERE appointment_id=a.id;
 IF p_note IS NOT NULL THEN
 IF a.status<>'in_consultation' OR length(trim(p_note)) NOT BETWEEN 1 AND 12000 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF e IS NULL THEN INSERT INTO hms.encounters(organization_id,branch_id,appointment_id,patient_id,doctor_id) VALUES(a.organization_id,a.branch_id,a.id,a.patient_id,a.doctor_id) RETURNING id INTO e; END IF;
 IF NOT EXISTS(SELECT 1 FROM hms.encounters WHERE id=e AND status='draft') THEN RAISE EXCEPTION 'SIGNED_RECORD'; END IF;
 SELECT coalesce(max(version),0)+1 INTO v FROM hms.clinical_notes WHERE encounter_id=e;
 INSERT INTO hms.clinical_notes(organization_id,encounter_id,version,body,author_user_id) VALUES(a.organization_id,e,v,p_note,auth.uid());
 ELSE SELECT body,version INTO n,v FROM hms.clinical_notes WHERE encounter_id=e ORDER BY version DESC LIMIT 1;
 END IF;
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(a.organization_id,a.branch_id,auth.uid(),CASE WHEN p_note IS NULL THEN 'clinical.draft.read' ELSE 'clinical.draft.write' END,'appointment',a.id,'success');
 RETURN jsonb_build_object('note',coalesce(p_note,n,''),'version',coalesce(v,0));
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hms_private FROM PUBLIC,anon,authenticated;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('hms_staff_context','hms_staff_appointments','hms_staff_patients','hms_staff_register','hms_staff_book','hms_staff_slots','hms_change_status','hms_collect_offline','hms_staff_generate','hms_staff_audit','hms_staff_team','hms_cancel_self','hms_clinical_draft') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.sig); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.sig);
 END LOOP;
END $$;
COMMIT;
