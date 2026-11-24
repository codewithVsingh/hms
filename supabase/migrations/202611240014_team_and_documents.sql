BEGIN;
-- Branch role assignment: existing identity only, no self-elevation or self-lockout.
CREATE FUNCTION public.hms_v3_team(p_org uuid,p_branch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'users.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (SELECT m.id,p.display_name name,m.active,(m.user_id=auth.uid()) self,coalesce(array_agg(ur.role_key ORDER BY ur.role_key) FILTER(WHERE ur.role_key IS NOT NULL),ARRAY[]::text[]) roles FROM hms.memberships m JOIN hms.profiles p ON p.user_id=m.user_id JOIN hms.membership_branches mb ON mb.organization_id=m.organization_id AND mb.membership_id=m.id AND mb.branch_id=p_branch LEFT JOIN hms.user_roles ur ON ur.organization_id=m.organization_id AND ur.membership_id=m.id AND ur.branch_id=p_branch WHERE m.organization_id=p_org GROUP BY m.id,p.display_name,m.active,m.user_id) q);
END;$$;
CREATE FUNCTION public.hms_v3_roles(p_org uuid,p_branch uuid,p_member uuid,p_roles text[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target hms.memberships%ROWTYPE; role text;
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'roles.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_branch::text,0));
 SELECT * INTO target FROM hms.memberships WHERE organization_id=p_org AND id=p_member AND active FOR UPDATE;
 IF NOT FOUND OR target.user_id=auth.uid() OR NOT EXISTS(SELECT 1 FROM hms.membership_branches WHERE organization_id=p_org AND membership_id=p_member AND branch_id=p_branch) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_roles IS NULL OR cardinality(p_roles)>6 OR EXISTS(SELECT 1 FROM unnest(p_roles) r(k) WHERE k IS NULL OR NOT EXISTS(SELECT 1 FROM hms.roles WHERE key=k)) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF 'doctor'=ANY(p_roles) AND NOT EXISTS(SELECT 1 FROM hms.doctors d JOIN hms.doctor_branches db ON db.doctor_id=d.id WHERE d.organization_id=p_org AND d.membership_id=p_member AND d.active AND db.branch_id=p_branch AND db.active) THEN RAISE EXCEPTION 'DOCTOR_PROFILE_REQUIRED'; END IF;
 DELETE FROM hms.user_roles WHERE organization_id=p_org AND membership_id=p_member AND branch_id=p_branch;
 FOREACH role IN ARRAY p_roles LOOP INSERT INTO hms.user_roles VALUES(p_org,p_member,p_branch,role) ON CONFLICT DO NOTHING; END LOOP;
 PERFORM hms_private.v3_audit(p_org,p_branch,'team.roles.change','membership',p_member);
END;$$;
-- Invitation linking uses service credentials only after an explicit admin context check in the server API.
-- Re-check the actual administrator's current branch permission from the database, not a supplied role name.
CREATE FUNCTION public.hms_v3_link_invite(p_org uuid,p_branch uuid,p_actor uuid,p_user uuid,p_name text,p_role text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE mid uuid;
BEGIN
 IF p_role NOT IN ('receptionist','billing','nurse','content_manager') OR length(trim(p_name)) NOT BETWEEN 2 AND 100 OR p_actor=p_user THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF NOT EXISTS(SELECT 1 FROM hms.memberships m JOIN hms.user_roles ur ON ur.organization_id=m.organization_id AND ur.membership_id=m.id AND ur.branch_id=p_branch JOIN hms.role_permissions rp ON rp.role_key=ur.role_key AND rp.permission_key='users.manage' WHERE m.organization_id=p_org AND m.user_id=p_actor AND m.active) OR NOT EXISTS(SELECT 1 FROM hms.branches WHERE id=p_branch AND organization_id=p_org AND active) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF EXISTS(SELECT 1 FROM hms.memberships WHERE user_id=p_user) THEN RAISE EXCEPTION 'EXISTING_MEMBERSHIP'; END IF;
 INSERT INTO hms.profiles(user_id,display_name) VALUES(p_user,trim(p_name)) ON CONFLICT(user_id) DO NOTHING;
 INSERT INTO hms.memberships(organization_id,user_id) VALUES(p_org,p_user) RETURNING id INTO mid;
 INSERT INTO hms.membership_branches VALUES(p_org,mid,p_branch);
 INSERT INTO hms.user_roles VALUES(p_org,mid,p_branch,p_role);
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(p_org,p_branch,p_actor,'team.invite','membership',mid,'success');
 RETURN mid;
END;$$;
-- Document uploads are not public; uploader must be an assigned clinician. Scanner approval required in server flow.
ALTER TABLE hms.patient_documents ADD COLUMN original_name text, ADD COLUMN appointment_id uuid REFERENCES hms.appointments(id), ADD COLUMN scan_state text NOT NULL DEFAULT 'quarantined' CHECK(scan_state IN ('quarantined','clean','rejected')), ADD COLUMN patient_visible boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.hms_v3_document_scope(p_id uuid,p_write boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE;
BEGIN
 a:=hms_private.v3_clinical_access(p_id,p_write);
 RETURN jsonb_build_object('org',a.organization_id,'branch',a.branch_id,'patient',a.patient_id,'appointment',a.id,'actor',auth.uid());
END;$$;
CREATE FUNCTION public.hms_v3_document_add(p_org uuid,p_branch uuid,p_patient uuid,p_appointment uuid,p_actor uuid,p_path text,p_mime text,p_bytes bigint,p_name text,p_type text,p_release boolean) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE did uuid;
BEGIN
 IF p_path NOT LIKE p_org::text||'/'||p_patient::text||'/%' OR p_bytes NOT BETWEEN 1 AND 10485760 OR p_mime NOT IN ('application/pdf','image/png','image/jpeg') OR p_type NOT IN ('report','image','referral','other') OR length(p_name)>180 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF NOT EXISTS(SELECT 1 FROM hms.appointments a JOIN hms.doctors d ON d.id=a.doctor_id JOIN hms.memberships m ON m.id=d.membership_id WHERE a.id=p_appointment AND a.organization_id=p_org AND a.branch_id=p_branch AND a.patient_id=p_patient AND m.user_id=p_actor AND m.active AND d.active) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 INSERT INTO hms.patient_documents(organization_id,branch_id,patient_id,appointment_id,storage_path,mime_type,byte_size,document_type,uploaded_by,original_name,scan_state,patient_visible) VALUES(p_org,p_branch,p_patient,p_appointment,p_path,p_mime,p_bytes,p_type,p_actor,p_name,'clean',p_release) RETURNING id INTO did;
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(p_org,p_branch,p_actor,'document.upload','document',did,'success'); RETURN did;
END;$$;
CREATE FUNCTION public.hms_v3_documents(p_appointment uuid,p_slug text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; org uuid; pid uuid;
BEGIN
 IF p_appointment IS NOT NULL THEN
  a:=hms_private.v3_clinical_access(p_appointment,false);
  PERFORM hms_private.v3_audit(a.organization_id,a.branch_id,'document.list','patient',a.patient_id);
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (SELECT id,original_name,document_type,mime_type,byte_size,created_at,patient_visible FROM hms.patient_documents WHERE organization_id=a.organization_id AND branch_id=a.branch_id AND patient_id=a.patient_id AND scan_state='clean' ORDER BY created_at DESC LIMIT 100) q);
 END IF;
 SELECT o.id,po.patient_id INTO org,pid FROM hms.organizations o JOIN hms.patient_owners po ON po.organization_id=o.id WHERE o.slug=p_slug AND o.active AND po.user_id=auth.uid();
 IF pid IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (SELECT id,original_name,document_type,mime_type,byte_size,created_at,patient_visible FROM hms.patient_documents WHERE organization_id=org AND patient_id=pid AND scan_state='clean' AND patient_visible ORDER BY created_at DESC LIMIT 100) q);
END;$$;
CREATE FUNCTION public.hms_v3_document_access(p_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d hms.patient_documents%ROWTYPE;
BEGIN
 SELECT * INTO d FROM hms.patient_documents WHERE id=p_id AND scan_state='clean';
 IF NOT FOUND OR NOT((d.patient_visible AND EXISTS(SELECT 1 FROM hms.patient_owners po WHERE po.organization_id=d.organization_id AND po.patient_id=d.patient_id AND po.user_id=auth.uid())) OR (hms_private.staff_permission(d.organization_id,d.branch_id,'clinical.assigned.read') AND hms_private.has_care_assignment(d.organization_id,d.branch_id,d.patient_id))) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM hms_private.v3_audit(d.organization_id,d.branch_id,'document.download','document',d.id); RETURN d.storage_path;
END;$$;
REVOKE ALL ON FUNCTION public.hms_v3_team(uuid,uuid),public.hms_v3_roles(uuid,uuid,uuid,text[]),public.hms_v3_link_invite(uuid,uuid,uuid,uuid,text,text),public.hms_v3_document_scope(uuid,boolean),public.hms_v3_document_add(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,boolean),public.hms_v3_documents(uuid,text),public.hms_v3_document_access(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hms_v3_team(uuid,uuid),public.hms_v3_roles(uuid,uuid,uuid,text[]),public.hms_v3_document_scope(uuid,boolean),public.hms_v3_documents(uuid,text),public.hms_v3_document_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hms_v3_link_invite(uuid,uuid,uuid,uuid,text,text),public.hms_v3_document_add(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,boolean) TO service_role;
COMMIT;
