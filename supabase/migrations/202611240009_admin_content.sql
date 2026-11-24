BEGIN;
INSERT INTO hms.permissions(key,description) VALUES('cms.review','Medically review proposed public content');
INSERT INTO hms.role_permissions VALUES('doctor','cms.review'),('super_admin','patients.demographics.read');
-- Published public content only. Expose no user IDs, private metadata or clinical information.
CREATE FUNCTION public.hms_public_content(p_slug text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind',c.kind,'slug',c.slug,'title',c.title,'summary',c.summary,'body',c.body,'seoTitle',c.seo_title,'seoDescription',c.seo_description,'updatedAt',c.updated_at) ORDER BY c.kind,c.title),'[]'::jsonb) FROM hms.content_entries c JOIN hms.organizations o ON o.id=c.organization_id AND o.active WHERE o.slug=p_slug AND c.status='published' AND c.published_at IS NOT NULL AND c.reviewed_at IS NOT NULL;
$$;
CREATE FUNCTION public.hms_content_list(p_org uuid,p_branch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT(hms_private.staff_permission(p_org,p_branch,'cms.manage') OR hms_private.staff_permission(p_org,p_branch,'cms.review') OR hms_private.staff_permission(p_org,p_branch,'cms.publish')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (SELECT id,kind,slug,title,summary,body,status,seo_title,seo_description,updated_at FROM hms.content_entries WHERE organization_id=p_org ORDER BY updated_at DESC LIMIT 200) q);
END; $$;
CREATE FUNCTION public.hms_content_save(p_org uuid,p_branch uuid,p_id uuid,p_kind text,p_slug text,p_title text,p_summary text,p_body text,p_seo_title text,p_seo_description text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cid uuid;
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'cms.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_kind NOT IN ('page','service','article','faq','landing') OR p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(p_slug)>80 OR p_title IS NULL OR length(trim(p_title)) NOT BETWEEN 2 AND 160 OR p_body IS NULL OR length(trim(p_body)) NOT BETWEEN 1 AND 20000 OR length(coalesce(p_summary,''))>400 OR length(coalesce(p_seo_title,''))>100 OR length(coalesce(p_seo_description,''))>200 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF p_id IS NULL THEN
 INSERT INTO hms.content_entries(organization_id,kind,slug,title,summary,body,seo_title,seo_description) VALUES(p_org,p_kind,p_slug,trim(p_title),p_summary,p_body,p_seo_title,p_seo_description) RETURNING id INTO cid;
 ELSE
 UPDATE hms.content_entries SET kind=p_kind,slug=p_slug,title=trim(p_title),summary=p_summary,body=p_body,seo_title=p_seo_title,seo_description=p_seo_description,updated_at=now() WHERE id=p_id AND organization_id=p_org AND status='draft' RETURNING id INTO cid;
 IF cid IS NULL THEN RAISE EXCEPTION 'CONTENT_LOCKED'; END IF;
 END IF;
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(p_org,p_branch,auth.uid(),'content.save','content',cid,'success');RETURN cid;
END; $$;
CREATE FUNCTION public.hms_content_transition(p_org uuid,p_branch uuid,p_id uuid,p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old text; allowed boolean:=false;
BEGIN
 SELECT status INTO old FROM hms.content_entries WHERE id=p_id AND organization_id=p_org FOR UPDATE;
 IF old='draft' AND p_status='medical_review' THEN allowed:=hms_private.staff_permission(p_org,p_branch,'cms.manage');
 ELSIF old='medical_review' AND p_status IN ('approved','draft') THEN allowed:=hms_private.staff_permission(p_org,p_branch,'cms.review');
 ELSIF old='approved' AND p_status='published' THEN allowed:=hms_private.staff_permission(p_org,p_branch,'cms.publish');
 ELSIF old='published' AND p_status='archived' THEN allowed:=hms_private.staff_permission(p_org,p_branch,'cms.publish');
 ELSIF old='archived' AND p_status='draft' THEN allowed:=hms_private.staff_permission(p_org,p_branch,'cms.manage'); END IF;
 IF NOT allowed THEN RAISE EXCEPTION 'FORBIDDEN_OR_INVALID_TRANSITION'; END IF;
 UPDATE hms.content_entries SET status=p_status,updated_at=now(),reviewed_by=CASE WHEN p_status='approved' THEN auth.uid() WHEN p_status='draft' THEN NULL ELSE reviewed_by END,reviewed_at=CASE WHEN p_status='approved' THEN now() WHEN p_status='draft' THEN NULL ELSE reviewed_at END,published_at=CASE WHEN p_status='published' THEN now() WHEN p_status='draft' THEN NULL ELSE published_at END WHERE id=p_id;
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(p_org,p_branch,auth.uid(),'content.'||p_status,'content',p_id,'success');
END; $$;
CREATE FUNCTION public.hms_admin_config(p_org uuid,p_branch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'settings.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN jsonb_build_object('settings',(SELECT jsonb_build_object('bookingEnabled',booking_enabled,'onlineEnabled',online_payment_enabled) FROM hms.hospital_settings WHERE organization_id=p_org AND branch_id=p_branch),'doctors',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.display_name,'feePaise',d.fee_paise,'published',d.published,'specialty',d.specialty)),'[]'::jsonb) FROM hms.doctors d JOIN hms.doctor_branches db ON db.organization_id=d.organization_id AND db.doctor_id=d.id WHERE d.organization_id=p_org AND db.branch_id=p_branch AND d.active AND db.active),'schedules',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'doctorId',s.doctor_id,'weekday',s.weekday,'start',s.start_local,'end',s.end_local,'minutes',s.slot_minutes,'active',s.active)),'[]'::jsonb) FROM hms.doctor_schedules s WHERE s.organization_id=p_org AND s.branch_id=p_branch));
END; $$;
CREATE FUNCTION public.hms_admin_settings(p_org uuid,p_branch uuid,p_booking boolean,p_online boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'settings.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 INSERT INTO hms.hospital_settings(organization_id,branch_id,booking_enabled,online_payment_enabled) VALUES(p_org,p_branch,p_booking,p_online) ON CONFLICT(organization_id,branch_id) DO UPDATE SET booking_enabled=excluded.booking_enabled,online_payment_enabled=excluded.online_payment_enabled;
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(p_org,p_branch,auth.uid(),'settings.booking.update','branch',p_branch,'success');
END; $$;
CREATE FUNCTION public.hms_admin_doctor(p_org uuid,p_branch uuid,p_doctor uuid,p_fee bigint,p_published boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'settings.manage') OR NOT EXISTS(SELECT 1 FROM hms.doctor_branches WHERE organization_id=p_org AND branch_id=p_branch AND doctor_id=p_doctor AND active) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_fee NOT BETWEEN 0 AND 10000000 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 UPDATE hms.doctors SET fee_paise=p_fee,published=p_published WHERE organization_id=p_org AND id=p_doctor AND active;
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(p_org,p_branch,auth.uid(),'doctor.public_settings.update','doctor',p_doctor,'success');
END; $$;
CREATE FUNCTION public.hms_admin_add_schedule(p_org uuid,p_branch uuid,p_doctor uuid,p_weekday smallint,p_start time,p_end time,p_minutes smallint) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'settings.manage') OR NOT EXISTS(SELECT 1 FROM hms.doctor_branches WHERE organization_id=p_org AND branch_id=p_branch AND doctor_id=p_doctor AND active) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_weekday NOT BETWEEN 0 AND 6 OR p_start>=p_end OR p_minutes NOT BETWEEN 5 AND 180 OR extract(epoch FROM p_end-p_start)<p_minutes*60 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_doctor::text,1));
 IF EXISTS(SELECT 1 FROM hms.doctor_schedules WHERE organization_id=p_org AND doctor_id=p_doctor AND weekday=p_weekday AND active AND start_local<p_end AND end_local>p_start) THEN RAISE EXCEPTION 'SCHEDULE_OVERLAP'; END IF;
 INSERT INTO hms.doctor_schedules(organization_id,doctor_id,branch_id,weekday,start_local,end_local,slot_minutes) VALUES(p_org,p_doctor,p_branch,p_weekday,p_start,p_end,p_minutes) RETURNING id INTO sid;
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(p_org,p_branch,auth.uid(),'schedule.create','schedule',sid,'success');RETURN sid;
END; $$;
-- Deactivate schedule without cancelling visits already booked; disable empty future matching slots.
CREATE FUNCTION public.hms_admin_disable_schedule(p_org uuid,p_branch uuid,p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s hms.doctor_schedules%ROWTYPE; tz text;
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'settings.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO s FROM hms.doctor_schedules WHERE organization_id=p_org AND branch_id=p_branch AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT timezone INTO tz FROM hms.branches WHERE id=p_branch AND organization_id=p_org;
 UPDATE hms.doctor_schedules SET active=false WHERE id=p_id;
 -- Lock each slot before checking visits. Existing confirmed/held visits stay intact for reception review.
 PERFORM 1 FROM hms.appointment_slots x WHERE x.organization_id=p_org AND x.branch_id=p_branch AND x.doctor_id=s.doctor_id AND x.starts_at>now() AND extract(dow FROM x.starts_at AT TIME ZONE tz)=s.weekday AND (x.starts_at AT TIME ZONE tz)::time>=s.start_local AND (x.ends_at AT TIME ZONE tz)::time<=s.end_local ORDER BY x.id FOR UPDATE;
 UPDATE hms.appointment_slots x SET enabled=false WHERE x.organization_id=p_org AND x.branch_id=p_branch AND x.doctor_id=s.doctor_id AND x.starts_at>now() AND extract(dow FROM x.starts_at AT TIME ZONE tz)=s.weekday AND (x.starts_at AT TIME ZONE tz)::time>=s.start_local AND (x.ends_at AT TIME ZONE tz)::time<=s.end_local AND NOT EXISTS(SELECT 1 FROM hms.appointments a WHERE a.slot_id=x.id AND (a.status IN ('confirmed','checked_in','in_consultation','completed','no_show') OR (a.status='held' AND a.hold_expires_at>now())));
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(p_org,p_branch,auth.uid(),'schedule.disable','schedule',p_id,'success');
END; $$;
REVOKE ALL ON FUNCTION public.hms_public_content(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hms_public_content(text) TO anon,authenticated;
DO $$ DECLARE r record; BEGIN FOR r IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('hms_content_list','hms_content_save','hms_content_transition','hms_admin_config','hms_admin_settings','hms_admin_doctor','hms_admin_add_schedule','hms_admin_disable_schedule') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.sig); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.sig); END LOOP; END $$;
COMMIT;
