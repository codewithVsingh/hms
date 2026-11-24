BEGIN;
-- Baseline permissions only. All writes denied to browser users; live service policies/RPCs follow in Phase 2.
INSERT INTO hms.roles(key,label,description) VALUES
 ('doctor','Doctor','Assigned-care clinical role'),('receptionist','Receptionist','Reception and scheduling'),
 ('billing','Billing staff','Financial operations only'),('nurse','Nurse / assistant','Assigned care support'),
 ('content_manager','Content manager','Public content workflow'),('super_admin','Super admin','Branch operations; no implicit clinical rights');
INSERT INTO hms.permissions(key,description) VALUES
 ('appointments.read','Read branch appointments'),('appointments.assigned.read','Read own assigned appointments'),
 ('appointments.create','Create or reschedule appointments'),('appointments.checkin','Check in patients'),
 ('patients.demographics.read','Read branch patient demographics'),('patients.assigned.read','Read assigned patient demographics'),
 ('patients.register','Register patients'),('clinical.assigned.read','Read assigned clinical records'),
 ('clinical.assigned.write','Write assigned clinical records'),('prescriptions.issue','Issue signed prescriptions'),
 ('billing.read','Read branch invoices and payments'),('payments.collect','Collect payments'),('refunds.approve','Approve refunds'),
 ('users.manage','Manage team memberships'),('roles.manage','Manage role assignments'),('cms.manage','Manage content'),
 ('cms.publish','Publish approved content'),('audit.read','Read audit events'),('settings.manage','Manage branch settings');
INSERT INTO hms.role_permissions(role_key,permission_key) VALUES
 ('doctor','appointments.assigned.read'),('doctor','patients.assigned.read'),('doctor','clinical.assigned.read'),('doctor','clinical.assigned.write'),('doctor','prescriptions.issue'),
 ('receptionist','appointments.read'),('receptionist','appointments.create'),('receptionist','appointments.checkin'),('receptionist','patients.demographics.read'),('receptionist','patients.register'),
 ('billing','billing.read'),('billing','payments.collect'),
 ('nurse','appointments.assigned.read'),
 ('content_manager','cms.manage'),
 ('super_admin','appointments.read'),('super_admin','billing.read'),('super_admin','payments.collect'),('super_admin','refunds.approve'),('super_admin','users.manage'),('super_admin','roles.manage'),('super_admin','cms.manage'),('super_admin','cms.publish'),('super_admin','audit.read'),('super_admin','settings.manage');
CREATE FUNCTION hms_private.has_permission(p_org uuid,p_branch uuid,p_perm text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
  SELECT 1 FROM hms.memberships m JOIN hms.organizations o ON o.id=m.organization_id AND o.active
  JOIN hms.user_roles ur ON ur.organization_id=m.organization_id AND ur.membership_id=m.id
  JOIN hms.branches b ON b.organization_id=ur.organization_id AND b.id=ur.branch_id AND b.active
  JOIN hms.role_permissions rp ON rp.role_key=ur.role_key
  WHERE m.user_id=(SELECT auth.uid()) AND m.active AND m.organization_id=p_org AND ur.branch_id=p_branch AND rp.permission_key=p_perm
 ); $$;
CREATE FUNCTION hms_private.is_assigned_doctor(p_org uuid,p_branch uuid,p_doctor uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
  SELECT 1 FROM hms.doctors d JOIN hms.memberships m ON m.organization_id=d.organization_id AND m.id=d.membership_id
  JOIN hms.doctor_branches db ON db.organization_id=d.organization_id AND db.doctor_id=d.id
  WHERE d.organization_id=p_org AND db.branch_id=p_branch AND d.id=p_doctor AND d.active AND db.active AND m.active AND m.user_id=(SELECT auth.uid())
 ); $$;
CREATE FUNCTION hms_private.has_care_assignment(p_org uuid,p_branch uuid,p_patient uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM hms.care_assignments ca WHERE ca.organization_id=p_org AND ca.branch_id=p_branch AND ca.patient_id=p_patient AND ca.revoked_at IS NULL AND hms_private.is_assigned_doctor(p_org,p_branch,ca.doctor_id)); $$;
CREATE FUNCTION hms_private.can_read_patient(p_org uuid,p_patient uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM hms.patient_branches pb WHERE pb.organization_id=p_org AND pb.patient_id=p_patient AND (
 hms_private.has_permission(p_org,pb.branch_id,'patients.demographics.read') OR
 (hms_private.has_permission(p_org,pb.branch_id,'patients.assigned.read') AND hms_private.has_care_assignment(p_org,pb.branch_id,p_patient)))); $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hms_private FROM PUBLIC,anon,authenticated;
-- RLS enabled on every hms table. No write policies, no client schema/table grants.
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='hms' LOOP
 EXECUTE format('ALTER TABLE hms.%I ENABLE ROW LEVEL SECURITY',t.tablename);
 END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA hms FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA hms FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA hms REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA hms REVOKE ALL ON SEQUENCES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA hms_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated;
-- Draft SELECT policies illustrate assigned-care and branch authorization. No grants yet, so direct client access stays denied.
CREATE POLICY appointments_read ON hms.appointments FOR SELECT TO authenticated USING (
 hms_private.has_permission(organization_id,branch_id,'appointments.read') OR
 (hms_private.has_permission(organization_id,branch_id,'appointments.assigned.read') AND hms_private.is_assigned_doctor(organization_id,branch_id,doctor_id)));
CREATE POLICY demographics_read ON hms.patients FOR SELECT TO authenticated USING(hms_private.can_read_patient(organization_id,id));
CREATE POLICY encounter_read ON hms.encounters FOR SELECT TO authenticated USING(
 hms_private.has_permission(organization_id,branch_id,'clinical.assigned.read') AND hms_private.has_care_assignment(organization_id,branch_id,patient_id));
CREATE POLICY invoices_read ON hms.invoices FOR SELECT TO authenticated USING(hms_private.has_permission(organization_id,branch_id,'billing.read'));
CREATE POLICY audit_read ON hms.audit_logs FOR SELECT TO authenticated USING(branch_id IS NOT NULL AND hms_private.has_permission(organization_id,branch_id,'audit.read'));
-- For live integration: grant only explicit columns/tables and helper EXECUTE/USAGE after tests;
-- keep schemas unexposed, avoid service_role for user requests, use a least-privilege backend DB role.
-- This deliberately does NOT turn the UI demo into a live system.
COMMIT;
