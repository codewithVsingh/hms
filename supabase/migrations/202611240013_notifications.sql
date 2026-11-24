BEGIN;
CREATE TABLE hms.notification_preferences(organization_id uuid NOT NULL,patient_id uuid NOT NULL,channel text NOT NULL CHECK(channel IN ('email','sms','whatsapp')),enabled boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,patient_id,channel),FOREIGN KEY(organization_id,patient_id) REFERENCES hms.patients(organization_id,id));
ALTER TABLE hms.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hms.notification_preferences FROM PUBLIC,anon,authenticated;
ALTER TABLE hms.notification_jobs ADD COLUMN lease_token uuid, ADD COLUMN leased_at timestamptz, ADD COLUMN provider_message_id text, ADD COLUMN last_error_code text;
CREATE FUNCTION public.hms_v3_preferences(p_slug text,p_channel text DEFAULT NULL,p_enabled boolean DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; pid uuid; u uuid:=auth.uid();
BEGIN
 SELECT o.id,po.patient_id INTO org,pid FROM hms.organizations o JOIN hms.patient_owners po ON po.organization_id=o.id WHERE o.slug=p_slug AND o.active AND po.user_id=u;
 IF pid IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_channel IS NOT NULL THEN
  IF p_channel NOT IN ('email','sms','whatsapp') OR p_enabled IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF p_enabled AND NOT EXISTS(SELECT 1 FROM auth.users au WHERE au.id=u AND CASE WHEN p_channel='email' THEN au.email_confirmed_at IS NOT NULL AND au.email IS NOT NULL ELSE au.phone_confirmed_at IS NOT NULL AND au.phone IS NOT NULL END) THEN RAISE EXCEPTION 'CONTACT_NOT_VERIFIED'; END IF;
  INSERT INTO hms.notification_preferences(organization_id,patient_id,channel,enabled) VALUES(org,pid,p_channel,p_enabled) ON CONFLICT(organization_id,patient_id,channel) DO UPDATE SET enabled=excluded.enabled,updated_at=now();
  INSERT INTO hms.consent_records(organization_id,patient_id,purpose,notice_version,status,recorded_by) VALUES(org,pid,'transactional_'||p_channel,'v3-transactional-1',CASE WHEN p_enabled THEN 'granted' ELSE 'withdrawn' END,u);
 END IF;
 RETURN (SELECT coalesce(jsonb_object_agg(channel,enabled),'{}'::jsonb) FROM hms.notification_preferences WHERE organization_id=org AND patient_id=pid);
END;$$;
CREATE FUNCTION hms_private.v3_enqueue(p_id uuid,p_template text,p_event text,p_due timestamptz) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO hms.notification_jobs(organization_id,appointment_id,channel,template_key,idempotency_key,next_attempt_at)
 SELECT a.organization_id,a.id,np.channel,p_template,a.id::text||':'||p_event||':'||np.channel,p_due FROM hms.appointments a JOIN hms.notification_preferences np ON np.organization_id=a.organization_id AND np.patient_id=a.patient_id AND np.enabled WHERE a.id=p_id
 ON CONFLICT(organization_id,idempotency_key) DO NOTHING;
$$;
CREATE FUNCTION hms_private.v3_notify_appointment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE starts timestamptz;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'confirmed' THEN RETURN NEW; END IF;
 ELSE
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.slot_id IS NOT DISTINCT FROM OLD.slot_id THEN RETURN NEW; END IF;
  UPDATE hms.notification_jobs SET state='failed',last_error_code='superseded' WHERE appointment_id=NEW.id AND state='queued' AND template_key IN ('reminder_24h','reminder_1h');
 END IF;
 IF NEW.status='confirmed' THEN
  SELECT starts_at INTO starts FROM hms.appointment_slots WHERE id=NEW.slot_id;
  IF TG_OP='UPDATE' AND NEW.slot_id IS DISTINCT FROM OLD.slot_id THEN PERFORM hms_private.v3_enqueue(NEW.id,'appointment_changed','move:'||NEW.slot_id::text||':'||NEW.updated_at::text,now());
  ELSE PERFORM hms_private.v3_enqueue(NEW.id,'appointment_confirmed','confirmed',now()); END IF;
  IF starts>now()+interval '24 hours' THEN PERFORM hms_private.v3_enqueue(NEW.id,'reminder_24h','24h:'||NEW.slot_id::text||':'||NEW.updated_at::text,starts-interval '24 hours'); END IF;
  IF starts>now()+interval '1 hour' THEN PERFORM hms_private.v3_enqueue(NEW.id,'reminder_1h','1h:'||NEW.slot_id::text||':'||NEW.updated_at::text,starts-interval '1 hour'); END IF;
 ELSIF NEW.status='cancelled' THEN PERFORM hms_private.v3_enqueue(NEW.id,'appointment_cancelled','cancelled',now());
 END IF; RETURN NEW;
END;$$;
CREATE TRIGGER hms_notify_appointment AFTER INSERT OR UPDATE OF status,slot_id ON hms.appointments FOR EACH ROW EXECUTE FUNCTION hms_private.v3_notify_appointment();
CREATE FUNCTION public.hms_v3_maintenance(p_slug text,p_branch text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; br uuid; tz text;
BEGIN
 SELECT o.id,b.id,b.timezone INTO org,br,tz FROM hms.organizations o JOIN hms.branches b ON b.organization_id=o.id WHERE o.slug=p_slug AND b.code=p_branch AND o.active AND b.active;
 IF br IS NULL THEN RAISE EXCEPTION 'CONFIGURATION_REQUIRED'; END IF;
 RETURN hms_private.generate_slots(org,br,(now() AT TIME ZONE tz)::date,31);
END;$$;
CREATE FUNCTION public.hms_v3_claim_notifications(p_slug text,p_branch text,p_channels text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j record; jobs jsonb:='[]'::jsonb; recipient text; valid boolean;
BEGIN
 -- An interrupted send is ambiguous: do not silently resend it.
 UPDATE hms.notification_jobs n SET state='dead_letter',last_error_code='delivery_unknown' FROM hms.appointments a JOIN hms.organizations o ON o.id=a.organization_id JOIN hms.branches b ON b.id=a.branch_id WHERE n.appointment_id=a.id AND o.slug=p_slug AND b.code=p_branch AND n.state='processing' AND n.leased_at<now()-interval '15 minutes';
 FOR j IN SELECT n.id,n.channel,n.template_key,n.appointment_id,n.organization_id,a.patient_id,a.status appointment_status,s.starts_at,au.email,au.phone,au.email_confirmed_at,au.phone_confirmed_at FROM hms.notification_jobs n JOIN hms.appointments a ON a.id=n.appointment_id JOIN hms.appointment_slots s ON s.id=a.slot_id JOIN hms.organizations o ON o.id=a.organization_id JOIN hms.branches b ON b.id=a.branch_id LEFT JOIN hms.patient_owners po ON po.organization_id=a.organization_id AND po.patient_id=a.patient_id LEFT JOIN auth.users au ON au.id=po.user_id WHERE o.slug=p_slug AND b.code=p_branch AND o.active AND b.active AND n.state='queued' AND n.next_attempt_at<=now() AND n.channel=ANY(p_channels) ORDER BY n.next_attempt_at LIMIT 10 FOR UPDATE OF n SKIP LOCKED LOOP
  recipient:=CASE WHEN j.channel='email' AND j.email_confirmed_at IS NOT NULL THEN j.email WHEN j.channel IN ('sms','whatsapp') AND j.phone_confirmed_at IS NOT NULL THEN j.phone ELSE NULL END;
  valid:=recipient IS NOT NULL AND EXISTS(SELECT 1 FROM hms.notification_preferences np WHERE np.organization_id=j.organization_id AND np.patient_id=j.patient_id AND np.channel=j.channel AND np.enabled) AND (j.template_key NOT IN ('reminder_24h','reminder_1h') OR j.appointment_status='confirmed' AND j.starts_at>now());
  IF NOT valid THEN UPDATE hms.notification_jobs SET state='failed',last_error_code='not_eligible' WHERE id=j.id; CONTINUE; END IF;
  UPDATE hms.notification_jobs SET state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),leased_at=now() WHERE id=j.id;
  jobs:=jobs||jsonb_build_array(jsonb_build_object('id',j.id,'channel',j.channel,'template',j.template_key,'recipient',recipient,'lease',(SELECT lease_token FROM hms.notification_jobs WHERE id=j.id)));
 END LOOP; RETURN jobs;
END;$$;
CREATE FUNCTION public.hms_v3_finish_notification(p_id uuid,p_lease uuid,p_state text,p_provider text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_state NOT IN ('sent','dead_letter','retry') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 UPDATE hms.notification_jobs SET state=CASE WHEN p_state='retry' AND attempts<4 THEN 'queued' WHEN p_state='sent' THEN 'sent' ELSE 'dead_letter' END, next_attempt_at=now()+make_interval(mins=>least(60,5*attempts)),provider_message_id=CASE WHEN p_state='sent' THEN left(p_provider,200) ELSE NULL END,last_error_code=CASE WHEN p_state='sent' THEN NULL WHEN p_state='retry' THEN 'rate_limited' ELSE 'delivery_review' END,lease_token=NULL WHERE id=p_id AND lease_token=p_lease AND state='processing';
END;$$;
CREATE FUNCTION public.hms_v3_notification_status(p_org uuid,p_branch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'settings.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (SELECT n.channel,n.template_key,n.state,n.attempts,n.last_error_code,n.created_at FROM hms.notification_jobs n JOIN hms.appointments a ON a.id=n.appointment_id WHERE a.organization_id=p_org AND a.branch_id=p_branch ORDER BY n.created_at DESC LIMIT 100) q);
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hms_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hms_v3_preferences(text,text,boolean),public.hms_v3_maintenance(text,text),public.hms_v3_claim_notifications(text,text,text[]),public.hms_v3_finish_notification(uuid,uuid,text,text),public.hms_v3_notification_status(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hms_v3_preferences(text,text,boolean),public.hms_v3_notification_status(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hms_v3_maintenance(text,text),public.hms_v3_claim_notifications(text,text,text[]),public.hms_v3_finish_notification(uuid,uuid,text,text) TO service_role;
COMMIT;
