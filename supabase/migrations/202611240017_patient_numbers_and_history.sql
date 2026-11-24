BEGIN;
-- Existing identifiers remain valid. New human-readable identifiers are not authentication secrets.
CREATE SEQUENCE hms_private.booking_number_seq AS bigint MINVALUE 1 MAXVALUE 78364164095 NO CYCLE;
CREATE SEQUENCE hms_private.patient_number_seq AS bigint MINVALUE 1 MAXVALUE 999999999 NO CYCLE;
CREATE FUNCTION hms_private.base36(p_value bigint) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE n bigint:=p_value; digits text:='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; result text:='';
BEGIN
 IF n<0 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 LOOP result:=substr(digits,(n%36)::integer+1,1)||result; n:=n/36; EXIT WHEN n=0; END LOOP;
 RETURN result;
END;$$;
CREATE FUNCTION hms_private.assign_short_booking() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.reference ~ '^APT-[A-F0-9]{32}$' THEN
  LOOP NEW.reference:='BK-'||lpad(hms_private.base36(nextval('hms_private.booking_number_seq'::regclass)),7,'0');
   EXIT WHEN NOT EXISTS(SELECT 1 FROM hms.appointments WHERE organization_id=NEW.organization_id AND reference=NEW.reference);
  END LOOP;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER short_booking_number BEFORE INSERT ON hms.appointments FOR EACH ROW EXECUTE FUNCTION hms_private.assign_short_booking();
CREATE FUNCTION hms_private.assign_short_patient() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n text;
BEGIN
 IF NEW.mrn ~ '^MRN-[A-F0-9]{32}$' THEN
  LOOP n:=nextval('hms_private.patient_number_seq'::regclass)::text; NEW.mrn:='PT-'||lpad(n,greatest(6,length(n)),'0');
   EXIT WHEN NOT EXISTS(SELECT 1 FROM hms.patients WHERE organization_id=NEW.organization_id AND mrn=NEW.mrn);
  END LOOP;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER short_patient_number BEFORE INSERT ON hms.patients FOR EACH ROW EXECUTE FUNCTION hms_private.assign_short_patient();
-- Show patient number on booking confirmation. Keep legacy booking/payment data intact.
CREATE OR REPLACE FUNCTION hms_private.booking_view(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',a.id,'reference',a.reference,'mrn',p.mrn,'status',CASE WHEN a.status='held' AND a.hold_expires_at<=now() THEN 'expired' ELSE a.status END,'expiresAt',a.hold_expires_at,'feePaise',a.fee_paise,'paymentChoice',a.payment_choice,'invoiceNumber',i.invoice_number,'orderId',po.provider_order_id,'paymentStatus',CASE WHEN po.status='reconciliation_required' THEN 'needs_review' WHEN EXISTS(SELECT 1 FROM hms.payments rp WHERE rp.invoice_id=i.id AND rp.status='partially_refunded') THEN 'partially_refunded' WHEN EXISTS(SELECT 1 FROM hms.payments rp WHERE rp.invoice_id=i.id AND rp.status='refunded') THEN 'refunded' WHEN i.status='settled' THEN 'paid' WHEN i.status='void' THEN 'void' WHEN i.order_claim IS NOT NULL AND po.id IS NULL THEN 'order_pending_review' ELSE 'unpaid' END,'doctor',d.display_name,'startsAt',s.starts_at,'patient',p.full_name)
 FROM hms.appointments a JOIN hms.appointment_slots s ON s.id=a.slot_id JOIN hms.doctors d ON d.id=a.doctor_id JOIN hms.patients p ON p.id=a.patient_id JOIN hms.invoices i ON i.appointment_id=a.id LEFT JOIN hms.payment_orders po ON po.invoice_id=i.id WHERE a.id=p_id;
$$;
-- Reception can record administrative handover, never edit doctor-issued prescriptions.
INSERT INTO hms.permissions(key,description) VALUES('prescriptions.archive','Record prescription handover and archive paper copies') ON CONFLICT DO NOTHING;
INSERT INTO hms.role_permissions(role_key,permission_key) VALUES('receptionist','prescriptions.archive') ON CONFLICT DO NOTHING;
CREATE TABLE hms.prescription_handover (
 organization_id uuid NOT NULL, branch_id uuid NOT NULL, appointment_id uuid NOT NULL, prescription_id uuid NOT NULL REFERENCES hms.prescriptions(id),
 handed_over_by uuid NOT NULL REFERENCES auth.users(id), handed_over_at timestamptz NOT NULL DEFAULT now(), method text NOT NULL CHECK(method IN ('printed','patient_portal','paper_copy')),
 PRIMARY KEY(prescription_id), FOREIGN KEY(organization_id,branch_id,appointment_id) REFERENCES hms.appointments(organization_id,branch_id,id)
);
CREATE TABLE hms.paper_prescription_archive (
 document_id uuid PRIMARY KEY REFERENCES hms.patient_documents(id), organization_id uuid NOT NULL, branch_id uuid NOT NULL, appointment_id uuid NOT NULL,
 uploaded_by uuid NOT NULL REFERENCES auth.users(id), uploaded_at timestamptz NOT NULL DEFAULT now(), verified_by uuid REFERENCES auth.users(id), verified_at timestamptz,
 FOREIGN KEY(organization_id,branch_id,appointment_id) REFERENCES hms.appointments(organization_id,branch_id,id), CHECK((verified_by IS NULL)=(verified_at IS NULL))
);
ALTER TABLE hms.prescription_handover ENABLE ROW LEVEL SECURITY;
ALTER TABLE hms.paper_prescription_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hms.prescription_handover,hms.paper_prescription_archive FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.hms_v4_rx_register(p_org uuid,p_branch uuid,p_mrn text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid;
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'prescriptions.archive') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT p.id INTO pid FROM hms.patients p JOIN hms.patient_branches b ON b.organization_id=p.organization_id AND b.patient_id=p.id WHERE p.organization_id=p_org AND b.branch_id=p_branch AND upper(p.mrn)=upper(trim(p_mrn));
 IF pid IS NULL THEN RETURN NULL; END IF;
 PERFORM hms_private.v3_audit(p_org,p_branch,'prescription.register.read','patient',pid);
 RETURN jsonb_build_object('patient',(SELECT full_name FROM hms.patients WHERE id=pid),'mrn',(SELECT mrn FROM hms.patients WHERE id=pid),
 'visits',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT a.id,a.reference,a.status,d.display_name doctor,s.starts_at FROM hms.appointments a JOIN hms.doctors d ON d.id=a.doctor_id JOIN hms.appointment_slots s ON s.id=a.slot_id WHERE a.organization_id=p_org AND a.branch_id=p_branch AND a.patient_id=pid AND a.status IN ('in_consultation','completed') ORDER BY s.starts_at DESC LIMIT 100) q),'[]'::jsonb),
 'prescriptions',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT r.id,a.reference,a.id appointment_id,r.signed_at,d.display_name doctor,r.version,h.handed_over_at,h.method FROM hms.prescriptions r JOIN hms.encounters e ON e.id=r.encounter_id JOIN hms.appointments a ON a.id=e.appointment_id JOIN hms.doctors d ON d.id=e.doctor_id LEFT JOIN hms.prescription_handover h ON h.prescription_id=r.id WHERE e.organization_id=p_org AND e.branch_id=p_branch AND e.patient_id=pid AND r.status='signed' ORDER BY r.signed_at DESC LIMIT 100) q),'[]'::jsonb),
 'paper',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT x.document_id,a.reference,x.uploaded_at,x.verified_at FROM hms.paper_prescription_archive x JOIN hms.appointments a ON a.id=x.appointment_id WHERE x.organization_id=p_org AND x.branch_id=p_branch AND a.patient_id=pid ORDER BY x.uploaded_at DESC LIMIT 100) q),'[]'::jsonb));
END;$$;
CREATE FUNCTION public.hms_v4_rx_handover(p_id uuid,p_method text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE;
BEGIN
 SELECT ap.* INTO a FROM hms.prescriptions r JOIN hms.encounters e ON e.id=r.encounter_id JOIN hms.appointments ap ON ap.id=e.appointment_id WHERE r.id=p_id AND r.status='signed';
 IF a.id IS NULL OR NOT hms_private.staff_permission(a.organization_id,a.branch_id,'prescriptions.archive') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_method NOT IN ('printed','patient_portal','paper_copy') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF p_method='patient_portal' AND NOT EXISTS(SELECT 1 FROM hms.prescriptions WHERE id=p_id AND release_to_patient) THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
 INSERT INTO hms.prescription_handover VALUES(a.organization_id,a.branch_id,a.id,p_id,auth.uid(),now(),p_method) ON CONFLICT(prescription_id) DO NOTHING;
 PERFORM hms_private.v3_audit(a.organization_id,a.branch_id,'prescription.handover','prescription',p_id);
END;$$;
CREATE FUNCTION public.hms_v4_paper_scope(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE;
BEGIN
 SELECT * INTO a FROM hms.appointments WHERE id=p_id AND status IN ('in_consultation','completed');
 IF a.id IS NULL OR NOT hms_private.staff_permission(a.organization_id,a.branch_id,'prescriptions.archive') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN jsonb_build_object('org',a.organization_id,'branch',a.branch_id,'patient',a.patient_id,'actor',auth.uid());
END;$$;
-- Called only after approved scanner returns clean. Recheck uploader membership and scope.
CREATE FUNCTION public.hms_v4_paper_add(p_appointment uuid,p_actor uuid,p_path text,p_mime text,p_bytes bigint,p_name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; did uuid;
BEGIN
 SELECT * INTO a FROM hms.appointments WHERE id=p_appointment AND status IN ('in_consultation','completed');
 IF a.id IS NULL OR NOT EXISTS(SELECT 1 FROM hms.memberships m JOIN hms.user_roles ur ON ur.organization_id=m.organization_id AND ur.membership_id=m.id AND ur.branch_id=a.branch_id JOIN hms.role_permissions rp ON rp.role_key=ur.role_key AND rp.permission_key='prescriptions.archive' JOIN hms.branches b ON b.id=ur.branch_id AND b.active JOIN hms.organizations o ON o.id=m.organization_id AND o.active WHERE m.organization_id=a.organization_id AND m.user_id=p_actor AND m.active) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_path NOT LIKE a.organization_id::text||'/'||a.patient_id::text||'/%' OR p_bytes NOT BETWEEN 1 AND 4194304 OR p_mime NOT IN ('application/pdf','image/png','image/jpeg') OR length(p_name)>180 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 INSERT INTO hms.patient_documents(organization_id,branch_id,patient_id,appointment_id,storage_path,mime_type,byte_size,document_type,uploaded_by,original_name,scan_state,patient_visible) VALUES(a.organization_id,a.branch_id,a.patient_id,a.id,p_path,p_mime,p_bytes,'paper_prescription',p_actor,p_name,'clean',false) RETURNING id INTO did;
 INSERT INTO hms.paper_prescription_archive(document_id,organization_id,branch_id,appointment_id,uploaded_by) VALUES(did,a.organization_id,a.branch_id,a.id,p_actor);
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(a.organization_id,a.branch_id,p_actor,'prescription.paper.archive','document',did,'success');
 RETURN did;
END;$$;
CREATE FUNCTION public.hms_v4_paper_verify(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE x hms.paper_prescription_archive%ROWTYPE; a hms.appointments%ROWTYPE;
BEGIN
 SELECT * INTO x FROM hms.paper_prescription_archive WHERE document_id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 a:=hms_private.v3_clinical_access(x.appointment_id,true);
 IF NOT hms_private.staff_permission(a.organization_id,a.branch_id,'prescriptions.issue') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 UPDATE hms.paper_prescription_archive SET verified_by=auth.uid(),verified_at=now() WHERE document_id=p_id AND verified_at IS NULL;
 PERFORM hms_private.v3_audit(a.organization_id,a.branch_id,'prescription.paper.verify','document',p_id);
END;$$;
-- Exact MRN search, paged history. Care assignment required; other doctors' drafts remain private.
CREATE FUNCTION public.hms_v4_patient_timeline(p_org uuid,p_branch uuid,p_mrn text,p_offset integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p hms.patients%ROWTYPE;
BEGIN
 IF p_offset<0 OR p_offset>100000 OR NOT hms_private.staff_permission(p_org,p_branch,'clinical.assigned.read') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO p FROM hms.patients x WHERE x.organization_id=p_org AND upper(x.mrn)=upper(trim(p_mrn)) AND hms_private.has_care_assignment(p_org,p_branch,x.id);
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM hms_private.v3_audit(p_org,p_branch,'clinical.mrn.timeline.read','patient',p.id);
 RETURN jsonb_build_object('name',p.full_name,'mrn',p.mrn,'offset',p_offset,
 'history',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT kind,detail,recorded_at FROM hms.patient_history WHERE organization_id=p_org AND branch_id=p_branch AND patient_id=p.id ORDER BY recorded_at DESC LIMIT 100) q),'[]'::jsonb),
 'visits',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT a.id,a.reference,a.status,s.starts_at,d.display_name doctor,e.status encounter_status,coalesce((SELECT n.body FROM hms.clinical_notes n WHERE n.encounter_id=e.id AND (n.signed_at IS NOT NULL OR hms_private.is_assigned_doctor(p_org,p_branch,a.doctor_id)) ORDER BY n.version DESC LIMIT 1),'') note,
 CASE WHEN e.status IN ('signed','amended') OR hms_private.is_assigned_doctor(p_org,p_branch,a.doctor_id) THEN coalesce((SELECT jsonb_agg(v.measurements ORDER BY v.recorded_at) FROM hms.vitals v WHERE v.encounter_id=e.id),'[]'::jsonb) ELSE '[]'::jsonb END vitals,
 CASE WHEN e.status IN ('signed','amended') OR hms_private.is_assigned_doctor(p_org,p_branch,a.doctor_id) THEN coalesce((SELECT jsonb_agg(dx.display_text) FROM hms.diagnoses dx WHERE dx.encounter_id=e.id),'[]'::jsonb) ELSE '[]'::jsonb END diagnoses,
 coalesce((SELECT jsonb_agg(hms_private.v3_rx_view(r.id) ORDER BY r.signed_at DESC) FROM hms.prescriptions r WHERE r.encounter_id=e.id AND r.status='signed'),'[]'::jsonb) prescriptions,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.document_id,'name',pd.original_name,'verifiedAt',x.verified_at,'uploadedAt',x.uploaded_at,'canVerify',hms_private.is_assigned_doctor(p_org,p_branch,a.doctor_id))) FROM hms.paper_prescription_archive x JOIN hms.patient_documents pd ON pd.id=x.document_id AND pd.scan_state='clean' WHERE x.appointment_id=a.id),'[]'::jsonb) paper
 FROM hms.appointments a JOIN hms.appointment_slots s ON s.id=a.slot_id JOIN hms.doctors d ON d.id=a.doctor_id LEFT JOIN hms.encounters e ON e.appointment_id=a.id WHERE a.organization_id=p_org AND a.branch_id=p_branch AND a.patient_id=p.id AND (a.status='completed' OR hms_private.is_assigned_doctor(p_org,p_branch,a.doctor_id)) ORDER BY s.starts_at DESC,a.id LIMIT 25 OFFSET p_offset) q),'[]'::jsonb));
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hms_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA hms_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hms_v4_rx_register(uuid,uuid,text),public.hms_v4_rx_handover(uuid,text),public.hms_v4_paper_scope(uuid),public.hms_v4_paper_add(uuid,uuid,text,text,bigint,text),public.hms_v4_paper_verify(uuid),public.hms_v4_patient_timeline(uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hms_v4_rx_register(uuid,uuid,text),public.hms_v4_rx_handover(uuid,text),public.hms_v4_paper_scope(uuid),public.hms_v4_paper_verify(uuid),public.hms_v4_patient_timeline(uuid,uuid,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hms_v4_paper_add(uuid,uuid,text,text,bigint,text) TO service_role;
COMMIT;
