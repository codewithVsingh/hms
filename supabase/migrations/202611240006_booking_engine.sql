-- Live booking RPCs. Existing private schemas remain inaccessible to browser users.
BEGIN;
CREATE TABLE hms.patient_owners (
 organization_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES auth.users(id), patient_id uuid NOT NULL,
 PRIMARY KEY(organization_id,user_id), UNIQUE(organization_id,patient_id),
 FOREIGN KEY(organization_id,patient_id) REFERENCES hms.patients(organization_id,id)
);
ALTER TABLE hms.appointments ADD COLUMN booking_user_id uuid REFERENCES auth.users(id), ADD COLUMN request_id uuid,
 ADD COLUMN payment_choice text NOT NULL DEFAULT 'hospital' CHECK(payment_choice IN ('online','hospital'));
CREATE UNIQUE INDEX booking_request_unique ON hms.appointments(booking_user_id,request_id) WHERE booking_user_id IS NOT NULL AND request_id IS NOT NULL;
CREATE UNIQUE INDEX invoice_appointment_unique ON hms.invoices(organization_id,appointment_id);
ALTER TABLE hms.invoices ADD COLUMN order_claim uuid, ADD COLUMN order_claimed_at timestamptz;
CREATE UNIQUE INDEX one_gateway_order_per_invoice ON hms.payment_orders(organization_id,invoice_id);
ALTER TABLE hms.patient_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hms.patient_owners FROM PUBLIC,anon,authenticated;

CREATE FUNCTION hms_private.generate_slots(p_org uuid,p_branch uuid,p_from date,p_days integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 IF p_days NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'INVALID_RANGE'; END IF;
 INSERT INTO hms.appointment_slots(organization_id,branch_id,doctor_id,starts_at,ends_at)
 SELECT s.organization_id,s.branch_id,s.doctor_id, t.start_at,t.start_at+make_interval(mins=>s.slot_minutes)
 FROM hms.doctor_schedules s JOIN hms.branches b ON b.id=s.branch_id AND b.organization_id=s.organization_id AND b.active
 JOIN hms.doctors d ON d.id=s.doctor_id AND d.organization_id=s.organization_id AND d.active
 JOIN hms.doctor_branches db ON db.organization_id=s.organization_id AND db.doctor_id=s.doctor_id AND db.branch_id=s.branch_id AND db.active
 CROSS JOIN LATERAL generate_series(0,p_days-1) AS day(n)
 CROSS JOIN LATERAL generate_series((p_from+day.n+s.start_local) AT TIME ZONE b.timezone, ((p_from+day.n+s.end_local) AT TIME ZONE b.timezone)-make_interval(mins=>s.slot_minutes),make_interval(mins=>s.slot_minutes)) AS t(start_at)
 WHERE s.organization_id=p_org AND s.branch_id=p_branch AND s.active AND extract(dow FROM p_from+day.n)=s.weekday
 AND t.start_at>now() AND NOT EXISTS(SELECT 1 FROM hms.doctor_leaves l WHERE l.organization_id=s.organization_id AND l.doctor_id=s.doctor_id AND tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(t.start_at,t.start_at+make_interval(mins=>s.slot_minutes),'[)'))
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END; $$;
CREATE FUNCTION public.hms_catalog(p_slug text,p_branch text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('branchId',b.id,'bookingEnabled',hs.booking_enabled,'onlineEnabled',hs.online_payment_enabled,'doctors',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'slug',d.public_slug,'name',d.display_name,'specialty',d.specialty,'feePaise',d.fee_paise,'bio',d.bio,'registrationNumber',d.registration_number) ORDER BY d.display_name) FROM hms.doctors d JOIN hms.doctor_branches db ON db.organization_id=d.organization_id AND db.doctor_id=d.id AND db.branch_id=b.id AND db.active WHERE d.organization_id=o.id AND d.active AND d.published),'[]'::jsonb))
 FROM hms.organizations o JOIN hms.branches b ON b.organization_id=o.id AND b.active JOIN hms.hospital_settings hs ON hs.organization_id=o.id AND hs.branch_id=b.id
 WHERE o.slug=p_slug AND o.active AND b.code=p_branch;
$$;
CREATE FUNCTION public.hms_available_slots(p_slug text,p_branch text,p_doctor uuid,p_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'startsAt',s.starts_at,'endsAt',s.ends_at) ORDER BY s.starts_at),'[]'::jsonb)
 FROM hms.appointment_slots s JOIN hms.organizations o ON o.id=s.organization_id AND o.active JOIN hms.branches b ON b.organization_id=o.id AND b.id=s.branch_id AND b.active
 JOIN hms.hospital_settings hs ON hs.organization_id=o.id AND hs.branch_id=b.id AND hs.booking_enabled
 JOIN hms.doctors d ON d.organization_id=o.id AND d.id=s.doctor_id AND d.active AND d.published JOIN hms.doctor_branches db ON db.organization_id=o.id AND db.branch_id=b.id AND db.doctor_id=d.id AND db.active
 WHERE o.slug=p_slug AND b.code=p_branch AND s.doctor_id=p_doctor AND s.enabled AND s.starts_at>now() AND p_date BETWEEN (now() AT TIME ZONE b.timezone)::date AND (now() AT TIME ZONE b.timezone)::date+30 AND (s.starts_at AT TIME ZONE b.timezone)::date=p_date
 AND EXISTS(SELECT 1 FROM hms.doctor_schedules sc WHERE sc.organization_id=o.id AND sc.branch_id=b.id AND sc.doctor_id=d.id AND sc.active AND sc.weekday=extract(dow FROM s.starts_at AT TIME ZONE b.timezone) AND (s.starts_at AT TIME ZONE b.timezone)::time>=sc.start_local AND (s.ends_at AT TIME ZONE b.timezone)::time<=sc.end_local)
 AND NOT EXISTS(SELECT 1 FROM hms.appointments a WHERE a.organization_id=o.id AND a.slot_id=s.id AND (a.status IN ('confirmed','checked_in','in_consultation','completed','no_show') OR (a.status='held' AND a.hold_expires_at>now())))
 AND NOT EXISTS(SELECT 1 FROM hms.doctor_leaves l WHERE l.organization_id=o.id AND l.doctor_id=d.id AND tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(s.starts_at,s.ends_at,'[)'));
$$;
CREATE FUNCTION hms_private.confirm_care(p_appointment uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO hms.care_assignments(organization_id,branch_id,patient_id,doctor_id)
 SELECT organization_id,branch_id,patient_id,doctor_id FROM hms.appointments WHERE id=p_appointment AND status='confirmed'
 ON CONFLICT(organization_id,branch_id,patient_id,doctor_id) WHERE revoked_at IS NULL DO NOTHING;
END; $$;
CREATE FUNCTION hms_private.booking_view(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',a.id,'reference',a.reference,'status',CASE WHEN a.status='held' AND a.hold_expires_at<=now() THEN 'expired' ELSE a.status END,'expiresAt',a.hold_expires_at,'feePaise',a.fee_paise,'paymentChoice',a.payment_choice,'invoiceNumber',i.invoice_number,'orderId',po.provider_order_id,'paymentStatus',CASE WHEN po.status='reconciliation_required' THEN 'needs_review' WHEN i.status='settled' THEN 'paid' WHEN EXISTS(SELECT 1 FROM hms.payments rp WHERE rp.invoice_id=i.id AND rp.status='refunded') THEN 'refunded' WHEN i.status='void' THEN 'void' WHEN i.order_claim IS NOT NULL AND po.id IS NULL THEN 'order_pending_review' ELSE 'unpaid' END,'doctor',d.display_name,'startsAt',s.starts_at,'patient',p.full_name)
 FROM hms.appointments a JOIN hms.appointment_slots s ON s.id=a.slot_id JOIN hms.doctors d ON d.id=a.doctor_id JOIN hms.patients p ON p.id=a.patient_id JOIN hms.invoices i ON i.appointment_id=a.id LEFT JOIN hms.payment_orders po ON po.invoice_id=i.id WHERE a.id=p_id;
$$;
CREATE FUNCTION hms_private.create_appointment(p_slot uuid,p_patient uuid,p_actor uuid,p_request uuid,p_payment text,p_source text,p_notice text,p_expected_fee bigint DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s hms.appointment_slots%ROWTYPE; d hms.doctors%ROWTYPE; hs hms.hospital_settings%ROWTYPE; b hms.branches%ROWTYPE; a_id uuid; i_id uuid; state text; fee bigint;
BEGIN
 IF p_payment NOT IN ('hospital','online') OR p_notice IS NULL OR length(p_notice) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT * INTO s FROM hms.appointment_slots WHERE id=p_slot FOR UPDATE;
 IF NOT FOUND OR NOT s.enabled OR s.starts_at<=now() THEN RAISE EXCEPTION 'SLOT_UNAVAILABLE'; END IF;
 SELECT * INTO d FROM hms.doctors WHERE id=s.doctor_id AND active FOR SHARE;
 SELECT * INTO b FROM hms.branches WHERE id=s.branch_id AND active;
 SELECT * INTO hs FROM hms.hospital_settings WHERE organization_id=s.organization_id AND branch_id=s.branch_id;
 IF d.id IS NULL OR b.id IS NULL OR NOT EXISTS(SELECT 1 FROM hms.organizations WHERE id=s.organization_id AND active) OR NOT EXISTS(SELECT 1 FROM hms.doctor_branches WHERE organization_id=s.organization_id AND branch_id=s.branch_id AND doctor_id=s.doctor_id AND active) OR EXISTS(SELECT 1 FROM hms.doctor_leaves l WHERE l.organization_id=s.organization_id AND l.doctor_id=s.doctor_id AND tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(s.starts_at,s.ends_at,'[)')) THEN RAISE EXCEPTION 'SLOT_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM hms.doctor_schedules sc WHERE sc.organization_id=s.organization_id AND sc.branch_id=s.branch_id AND sc.doctor_id=s.doctor_id AND sc.active AND sc.weekday=extract(dow FROM s.starts_at AT TIME ZONE b.timezone) AND (s.starts_at AT TIME ZONE b.timezone)::time>=sc.start_local AND (s.ends_at AT TIME ZONE b.timezone)::time<=sc.end_local) THEN RAISE EXCEPTION 'SLOT_UNAVAILABLE'; END IF;
 IF p_source='online' AND (NOT d.published OR hs.booking_enabled IS DISTINCT FROM true OR (s.starts_at AT TIME ZONE b.timezone)::date>(now() AT TIME ZONE b.timezone)::date+30) THEN RAISE EXCEPTION 'BOOKING_DISABLED'; END IF;
 fee:=d.fee_paise;
 IF p_expected_fee IS NOT NULL AND p_expected_fee<>fee THEN RAISE EXCEPTION 'FEE_CHANGED'; END IF;
 IF p_payment='online' AND (hs.online_payment_enabled IS DISTINCT FROM true OR fee<=0) THEN RAISE EXCEPTION 'ONLINE_PAYMENT_DISABLED'; END IF;
 PERFORM hms_private.expire_slot_holds(s.organization_id,s.id);
 IF EXISTS(SELECT 1 FROM hms.appointments WHERE organization_id=s.organization_id AND slot_id=s.id AND status IN ('held','confirmed','checked_in','in_consultation','completed','no_show')) THEN RAISE EXCEPTION 'SLOT_UNAVAILABLE'; END IF;
 INSERT INTO hms.patient_branches(organization_id,patient_id,branch_id) VALUES(s.organization_id,p_patient,s.branch_id) ON CONFLICT DO NOTHING;
 state:=CASE WHEN p_payment='online' THEN 'held' ELSE 'confirmed' END;
 INSERT INTO hms.appointments(organization_id,branch_id,doctor_id,patient_id,slot_id,reference,status,source,hold_expires_at,fee_paise,booking_user_id,request_id,payment_choice)
 VALUES(s.organization_id,s.branch_id,s.doctor_id,p_patient,s.id,'APT-'||upper(replace(gen_random_uuid()::text,'-','')),state,p_source,CASE WHEN state='held' THEN now()+interval '10 minutes' END,fee,p_actor,p_request,p_payment) RETURNING id INTO a_id;
 INSERT INTO hms.invoices(organization_id,branch_id,appointment_id,invoice_number,total_paise,status,issued_at) VALUES(s.organization_id,s.branch_id,a_id,'INV-'||upper(replace(gen_random_uuid()::text,'-','')),fee,CASE WHEN fee=0 THEN 'settled' ELSE 'issued' END,now()) RETURNING id INTO i_id;
 INSERT INTO hms.invoice_items(organization_id,invoice_id,description,quantity,unit_paise) VALUES(s.organization_id,i_id,'Consultation fee',1,fee);
 INSERT INTO hms.appointment_status_history(organization_id,appointment_id,to_status,actor_user_id) VALUES(s.organization_id,a_id,state,p_actor);
 INSERT INTO hms.consent_records(organization_id,patient_id,purpose,notice_version,status,recorded_by) VALUES(s.organization_id,p_patient,'appointment_booking',p_notice,'granted',p_actor);
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(s.organization_id,s.branch_id,p_actor,'appointment.create','appointment',a_id,'success');
 IF state='confirmed' THEN PERFORM hms_private.confirm_care(a_id); END IF;
 RETURN a_id;
END; $$;
CREATE FUNCTION public.hms_book_self(p_slug text,p_branch text,p_slot uuid,p_name text,p_payment text,p_request uuid,p_notice text,p_adult boolean,p_expected_fee bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); phone text; org uuid; pid uuid; aid uuid; pname text;
BEGIN
 IF u IS NULL OR p_request IS NULL OR p_expected_fee IS NULL OR p_expected_fee<0 OR p_adult IS DISTINCT FROM true OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT au.phone INTO phone FROM auth.users au WHERE au.id=u AND au.phone_confirmed_at IS NOT NULL;
 IF phone IS NULL OR phone='' THEN RAISE EXCEPTION 'PHONE_VERIFICATION_REQUIRED'; END IF;
 SELECT o.id INTO org FROM hms.appointment_slots s JOIN hms.organizations o ON o.id=s.organization_id AND o.slug=p_slug AND o.active JOIN hms.branches b ON b.id=s.branch_id AND b.code=p_branch AND b.active WHERE s.id=p_slot;
 IF org IS NULL THEN RAISE EXCEPTION 'SLOT_UNAVAILABLE'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(u::text,0));
 SELECT id INTO aid FROM hms.appointments WHERE booking_user_id=u AND request_id=p_request AND organization_id=org AND source='online';
 IF aid IS NOT NULL THEN RETURN hms_private.booking_view(aid); END IF;
 IF (SELECT count(*) FROM hms.appointments a JOIN hms.appointment_slots s ON s.id=a.slot_id WHERE a.booking_user_id=u AND a.source='online' AND s.starts_at>now() AND (a.status='confirmed' OR (a.status='held' AND a.hold_expires_at>now())))>=3 OR (SELECT count(*) FROM hms.appointments WHERE booking_user_id=u AND source='online' AND created_at>now()-interval '1 hour')>=8 THEN RAISE EXCEPTION 'BOOKING_LIMIT'; END IF;
 SELECT po.patient_id,p.full_name INTO pid,pname FROM hms.patient_owners po JOIN hms.patients p ON p.id=po.patient_id WHERE po.organization_id=org AND po.user_id=u;
 IF pid IS NULL THEN
 INSERT INTO hms.patients(organization_id,mrn,full_name) VALUES(org,'MRN-'||upper(replace(gen_random_uuid()::text,'-','')),trim(p_name)) RETURNING id INTO pid;
 INSERT INTO hms.patient_owners VALUES(org,u,pid);
 INSERT INTO hms.patient_contacts(organization_id,patient_id,kind,contact_value,verified_at) VALUES(org,pid,'phone',phone,now());
 ELSIF lower(trim(p_name))<>lower(trim(pname)) THEN RAISE EXCEPTION 'PATIENT_NAME_MISMATCH'; END IF;
 aid:=hms_private.create_appointment(p_slot,pid,u,p_request,p_payment,'online',p_notice,p_expected_fee);
 RETURN hms_private.booking_view(aid);
END; $$;
CREATE FUNCTION public.hms_my_bookings(p_slug text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(v ORDER BY created_at DESC),'[]'::jsonb) FROM (SELECT hms_private.booking_view(a.id) v,a.created_at FROM hms.appointments a JOIN hms.organizations o ON o.id=a.organization_id AND o.slug=p_slug WHERE a.booking_user_id=auth.uid() AND a.source='online' ORDER BY a.created_at DESC LIMIT 50) q;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hms_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hms_catalog(text,text),public.hms_available_slots(text,text,uuid,date),public.hms_book_self(text,text,uuid,text,text,uuid,text,boolean,bigint),public.hms_my_bookings(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hms_catalog(text,text),public.hms_available_slots(text,text,uuid,date) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hms_book_self(text,text,uuid,text,text,uuid,text,boolean,bigint),public.hms_my_bookings(text) TO authenticated;
COMMIT;
