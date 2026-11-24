BEGIN;
CREATE TABLE hms.appointment_moves(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, appointment_id uuid NOT NULL, old_slot uuid NOT NULL REFERENCES hms.appointment_slots(id), new_slot uuid NOT NULL REFERENCES hms.appointment_slots(id), actor uuid REFERENCES auth.users(id), moved_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,appointment_id) REFERENCES hms.appointments(organization_id,id));
CREATE TABLE hms.queue_counters(organization_id uuid NOT NULL,branch_id uuid NOT NULL,visit_day date NOT NULL,last_token integer NOT NULL DEFAULT 0,PRIMARY KEY(organization_id,branch_id,visit_day),FOREIGN KEY(organization_id,branch_id) REFERENCES hms.branches(organization_id,id));
ALTER TABLE hms.appointments ADD COLUMN queue_token integer, ADD COLUMN queue_day date, ADD COLUMN checked_in_at timestamptz;
CREATE UNIQUE INDEX hms_queue_unique ON hms.appointments(organization_id,branch_id,queue_day,queue_token) WHERE queue_token IS NOT NULL;
CREATE FUNCTION hms_private.v3_queue_token() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tz text;
BEGIN
 IF NEW.status='checked_in' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.queue_token IS NULL THEN
  SELECT timezone INTO tz FROM hms.branches WHERE id=NEW.branch_id;
  NEW.queue_day:=(now() AT TIME ZONE tz)::date; NEW.checked_in_at:=now();
  INSERT INTO hms.queue_counters(organization_id,branch_id,visit_day,last_token) VALUES(NEW.organization_id,NEW.branch_id,NEW.queue_day,1) ON CONFLICT(organization_id,branch_id,visit_day) DO UPDATE SET last_token=hms.queue_counters.last_token+1 RETURNING last_token INTO NEW.queue_token;
 END IF; RETURN NEW;
END;$$;
CREATE TRIGGER hms_queue_on_checkin BEFORE UPDATE OF status ON hms.appointments FOR EACH ROW EXECUTE FUNCTION hms_private.v3_queue_token();
CREATE FUNCTION public.hms_v3_reschedule(p_id uuid,p_slot uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; s hms.appointment_slots%ROWTYPE; i hms.invoices%ROWTYPE; old_slot uuid; tz text; self_book boolean;
BEGIN
 SELECT * INTO a FROM hms.appointments WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 self_book:=a.booking_user_id=auth.uid() AND a.source='online';
 IF NOT coalesce(self_book,false) AND NOT hms_private.staff_permission(a.organization_id,a.branch_id,'appointments.create') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 old_slot:=a.slot_id; IF old_slot=p_slot THEN RETURN hms_private.booking_view(a.id); END IF;
 -- Lock both slot rows in deterministic order, then the appointment/invoice.
 PERFORM 1 FROM hms.appointment_slots WHERE id IN(old_slot,p_slot) ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM hms.appointments WHERE id=p_id FOR UPDATE; SELECT * INTO i FROM hms.invoices WHERE appointment_id=a.id FOR UPDATE;
 IF a.slot_id<>old_slot OR a.status<>'confirmed' OR NOT EXISTS(SELECT 1 FROM hms.appointment_slots WHERE id=old_slot AND starts_at>now()) OR (i.order_claim IS NOT NULL AND i.status<>'settled') OR EXISTS(SELECT 1 FROM hms.payments WHERE invoice_id=i.id AND status IN ('reconciliation_required','pending','refunded','partially_refunded')) THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
 SELECT * INTO s FROM hms.appointment_slots WHERE id=p_slot AND organization_id=a.organization_id AND branch_id=a.branch_id AND doctor_id=a.doctor_id AND enabled AND starts_at>now();
 IF s.id IS NULL THEN RAISE EXCEPTION 'SLOT_UNAVAILABLE'; END IF;
 SELECT timezone INTO tz FROM hms.branches WHERE id=a.branch_id AND active;
 IF tz IS NULL OR (s.starts_at AT TIME ZONE tz)::date>(now() AT TIME ZONE tz)::date+30 OR NOT EXISTS(SELECT 1 FROM hms.doctors d JOIN hms.doctor_branches db ON db.organization_id=d.organization_id AND db.doctor_id=d.id WHERE d.id=a.doctor_id AND d.active AND db.branch_id=a.branch_id AND db.active AND (NOT coalesce(self_book,false) OR d.published)) OR NOT EXISTS(SELECT 1 FROM hms.doctor_schedules sc WHERE sc.organization_id=a.organization_id AND sc.branch_id=a.branch_id AND sc.doctor_id=a.doctor_id AND sc.active AND sc.weekday=extract(dow FROM s.starts_at AT TIME ZONE tz) AND (s.starts_at AT TIME ZONE tz)::time>=sc.start_local AND (s.ends_at AT TIME ZONE tz)::time<=sc.end_local) OR EXISTS(SELECT 1 FROM hms.doctor_leaves l WHERE l.organization_id=a.organization_id AND l.doctor_id=a.doctor_id AND tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(s.starts_at,s.ends_at,'[)')) THEN RAISE EXCEPTION 'SLOT_UNAVAILABLE'; END IF;
 IF coalesce(self_book,false) AND NOT EXISTS(SELECT 1 FROM hms.hospital_settings WHERE organization_id=a.organization_id AND branch_id=a.branch_id AND booking_enabled) THEN RAISE EXCEPTION 'BOOKING_DISABLED'; END IF;
 PERFORM hms_private.expire_slot_holds(a.organization_id,p_slot);
 IF EXISTS(SELECT 1 FROM hms.appointments WHERE slot_id=p_slot AND status IN ('held','confirmed','checked_in','in_consultation','completed','no_show')) THEN RAISE EXCEPTION 'SLOT_UNAVAILABLE'; END IF;
 UPDATE hms.appointments SET slot_id=p_slot,updated_at=now() WHERE id=a.id;
 INSERT INTO hms.appointment_moves(organization_id,appointment_id,old_slot,new_slot,actor) VALUES(a.organization_id,a.id,old_slot,p_slot,auth.uid());
 PERFORM hms_private.v3_audit(a.organization_id,a.branch_id,'appointment.reschedule','appointment',a.id);
 RETURN hms_private.booking_view(a.id);
END;$$;
CREATE FUNCTION public.hms_v3_queue(p_org uuid,p_branch uuid,p_day date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT(hms_private.staff_permission(p_org,p_branch,'appointments.read') OR hms_private.staff_permission(p_org,p_branch,'appointments.assigned.read')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.token),'[]'::jsonb) FROM (SELECT a.id,a.queue_token token,a.reference,a.status,p.full_name patient,d.display_name doctor,a.checked_in_at FROM hms.appointments a JOIN hms.patients p ON p.id=a.patient_id JOIN hms.doctors d ON d.id=a.doctor_id WHERE a.organization_id=p_org AND a.branch_id=p_branch AND a.queue_day=p_day AND (hms_private.staff_permission(p_org,p_branch,'appointments.read') OR hms_private.is_assigned_doctor(p_org,p_branch,a.doctor_id)) ORDER BY a.queue_token LIMIT 200) q);
END;$$;
CREATE FUNCTION public.hms_v3_leaves(p_org uuid,p_branch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT(hms_private.staff_permission(p_org,p_branch,'settings.manage') OR hms_private.staff_permission(p_org,p_branch,'appointments.assigned.read')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN jsonb_build_object('doctors',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.display_name)) FROM hms.doctors d JOIN hms.doctor_branches db ON db.doctor_id=d.id WHERE d.organization_id=p_org AND db.branch_id=p_branch AND d.active AND db.active AND (hms_private.staff_permission(p_org,p_branch,'settings.manage') OR hms_private.is_assigned_doctor(p_org,p_branch,d.id))),'[]'::jsonb),'leaves',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT l.id,d.display_name doctor,l.starts_at,l.ends_at FROM hms.doctor_leaves l JOIN hms.doctors d ON d.id=l.doctor_id WHERE l.organization_id=p_org AND l.branch_id=p_branch AND l.ends_at>now() AND (hms_private.staff_permission(p_org,p_branch,'settings.manage') OR hms_private.is_assigned_doctor(p_org,p_branch,l.doctor_id)) ORDER BY l.starts_at LIMIT 100) q),'[]'::jsonb));
END;$$;
CREATE FUNCTION public.hms_v3_leave_add(p_org uuid,p_branch uuid,p_doctor uuid,p_start timestamptz,p_end timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE lid uuid;
BEGIN
 IF NOT(hms_private.staff_permission(p_org,p_branch,'settings.manage') OR (hms_private.staff_permission(p_org,p_branch,'appointments.assigned.read') AND hms_private.is_assigned_doctor(p_org,p_branch,p_doctor))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_start<now() OR p_end<=p_start OR p_end>p_start+interval '90 days' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 PERFORM 1 FROM hms.appointment_slots WHERE organization_id=p_org AND doctor_id=p_doctor AND tstzrange(starts_at,ends_at,'[)') && tstzrange(p_start,p_end,'[)') ORDER BY id FOR UPDATE;
 PERFORM 1 FROM hms.doctors WHERE organization_id=p_org AND id=p_doctor FOR UPDATE;
 IF EXISTS(SELECT 1 FROM hms.appointments a JOIN hms.appointment_slots s ON s.id=a.slot_id WHERE a.organization_id=p_org AND a.doctor_id=p_doctor AND tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(p_start,p_end,'[)') AND (a.status IN ('confirmed','checked_in','in_consultation') OR a.status='held' AND a.hold_expires_at>now())) THEN RAISE EXCEPTION 'LEAVE_HAS_BOOKINGS'; END IF;
 INSERT INTO hms.doctor_leaves(organization_id,branch_id,doctor_id,starts_at,ends_at) VALUES(p_org,p_branch,p_doctor,p_start,p_end) RETURNING id INTO lid;
 PERFORM hms_private.v3_audit(p_org,p_branch,'doctor.leave.add','doctor_leave',lid); RETURN lid;
END;$$;
CREATE FUNCTION public.hms_v3_reports(p_org uuid,p_branch uuid,p_from date,p_to date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tz text;
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'billing.read') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>366 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT timezone INTO tz FROM hms.branches WHERE id=p_branch AND organization_id=p_org;
 RETURN jsonb_build_object('visits',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.day) FROM (SELECT (s.starts_at AT TIME ZONE tz)::date AS day,count(*) visits,count(*) FILTER(WHERE a.status='completed') completed,count(*) FILTER(WHERE a.status='cancelled') cancelled,count(*) FILTER(WHERE a.status='no_show') no_show,count(*) FILTER(WHERE a.source='online') online FROM hms.appointments a JOIN hms.appointment_slots s ON s.id=a.slot_id WHERE a.organization_id=p_org AND a.branch_id=p_branch AND (s.starts_at AT TIME ZONE tz)::date BETWEEN p_from AND p_to GROUP BY 1) q),'[]'::jsonb), 'collections',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT p.method,sum(p.amount_paise) total,count(*) transactions FROM hms.payments p JOIN hms.invoices i ON i.id=p.invoice_id WHERE i.organization_id=p_org AND i.branch_id=p_branch AND p.status IN ('captured','refunded','partially_refunded') AND (p.captured_at AT TIME ZONE tz)::date BETWEEN p_from AND p_to GROUP BY p.method) q),'[]'::jsonb),'refundPaise',coalesce((SELECT sum(r.amount_paise) FROM hms.refunds r JOIN hms.payments p ON p.id=r.payment_id JOIN hms.invoices i ON i.id=p.invoice_id WHERE i.organization_id=p_org AND i.branch_id=p_branch AND r.status='processed' AND (r.created_at AT TIME ZONE tz)::date BETWEEN p_from AND p_to),0));
END;$$;
CREATE FUNCTION public.hms_v3_invoice(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; i hms.invoices%ROWTYPE;
BEGIN
 SELECT * INTO a FROM hms.appointments WHERE id=p_id;
 IF NOT FOUND OR NOT(coalesce(a.booking_user_id=auth.uid() AND a.source='online',false) OR hms_private.staff_permission(a.organization_id,a.branch_id,'billing.read')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO i FROM hms.invoices WHERE appointment_id=a.id;
 PERFORM hms_private.v3_audit(a.organization_id,a.branch_id,'invoice.read','invoice',i.id);
 RETURN jsonb_build_object('number',i.invoice_number,'reference',a.reference,'status',i.status,'issuedAt',i.issued_at,'totalPaise',i.total_paise,'items',coalesce((SELECT jsonb_agg(jsonb_build_object('description',description,'quantity',quantity,'unitPaise',unit_paise,'totalPaise',total_paise)) FROM hms.invoice_items WHERE invoice_id=i.id),'[]'::jsonb));
END;$$;
ALTER TABLE hms.appointment_moves ENABLE ROW LEVEL SECURITY; ALTER TABLE hms.queue_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hms.appointment_moves,hms.queue_counters FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hms_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hms_v3_reschedule(uuid,uuid),public.hms_v3_queue(uuid,uuid,date),public.hms_v3_leaves(uuid,uuid),public.hms_v3_leave_add(uuid,uuid,uuid,timestamptz,timestamptz),public.hms_v3_reports(uuid,uuid,date,date),public.hms_v3_invoice(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hms_v3_reschedule(uuid,uuid),public.hms_v3_queue(uuid,uuid,date),public.hms_v3_leaves(uuid,uuid),public.hms_v3_leave_add(uuid,uuid,uuid,timestamptz,timestamptz),public.hms_v3_reports(uuid,uuid,date,date),public.hms_v3_invoice(uuid) TO authenticated;
COMMIT;
