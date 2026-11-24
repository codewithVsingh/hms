-- EDIT the values first. Safe by default: refuses to run while placeholders remain.
-- Create/invite actual workforce users in Supabase Auth before running.
BEGIN;
DO $$
DECLARE
 hospital_slug text := 'REPLACE_HOSPITAL_SLUG';
 hospital_name text := 'REPLACE_HOSPITAL_NAME';
 admin_email text := 'REPLACE_ADMIN_EMAIL';
 doctor_email text := 'REPLACE_DOCTOR_EMAIL';
 doctor_name text := 'REPLACE_DOCTOR_NAME';
 doctor_specialty text := 'REPLACE_SPECIALTY';
 doctor_registration text := 'REPLACE_REGISTRATION';
 reception_email text := 'REPLACE_RECEPTION_EMAIL';
 consultation_fee_paise bigint := 50000; -- EXAMPLE ONLY: replace with the approved fee.
 org uuid; branch uuid; dept uuid; u uuid; m uuid; doctor_id uuid; rec record;
BEGIN
 IF hospital_slug LIKE 'REPLACE%' OR hospital_name LIKE 'REPLACE%' OR admin_email LIKE 'REPLACE%' OR doctor_email LIKE 'REPLACE%' OR doctor_name LIKE 'REPLACE%' OR doctor_specialty LIKE 'REPLACE%' OR doctor_registration LIKE 'REPLACE%' OR reception_email LIKE 'REPLACE%' THEN RAISE EXCEPTION 'Replace all setup placeholders first'; END IF;
 INSERT INTO hms.organizations(slug,name) VALUES(hospital_slug,hospital_name) ON CONFLICT(slug) DO UPDATE SET name=excluded.name RETURNING id INTO org;
 INSERT INTO hms.branches(organization_id,code,name) VALUES(org,'MAIN','Main branch') ON CONFLICT(organization_id,code) DO UPDATE SET name=excluded.name RETURNING id INTO branch;
 INSERT INTO hms.hospital_settings(organization_id,branch_id,booking_enabled,online_payment_enabled) VALUES(org,branch,false,false) ON CONFLICT DO NOTHING;
 INSERT INTO hms.departments(organization_id,name) VALUES(org,doctor_specialty) ON CONFLICT(organization_id,name) DO UPDATE SET name=excluded.name RETURNING id INTO dept;
 FOR rec IN SELECT * FROM (VALUES(admin_email,'Hospital administrator','super_admin'),(doctor_email,doctor_name,'doctor'),(reception_email,'Reception','receptionist'),(reception_email,'Reception','billing')) AS x(email,label,role_key) LOOP
 SELECT id INTO u FROM auth.users WHERE lower(email)=lower(rec.email); IF u IS NULL THEN RAISE EXCEPTION 'Provision all Auth users before applying setup'; END IF;
 INSERT INTO hms.profiles(user_id,display_name) VALUES(u,rec.label) ON CONFLICT(user_id) DO NOTHING;
 INSERT INTO hms.memberships(organization_id,user_id) VALUES(org,u) ON CONFLICT(organization_id,user_id) DO UPDATE SET active=true RETURNING id INTO m;
 INSERT INTO hms.membership_branches VALUES(org,m,branch) ON CONFLICT DO NOTHING;
 INSERT INTO hms.user_roles VALUES(org,m,branch,rec.role_key) ON CONFLICT DO NOTHING;
 IF rec.role_key='doctor' THEN
 INSERT INTO hms.doctors(organization_id,membership_id,department_id,public_slug,display_name,specialty,registration_number,fee_paise,published) VALUES(org,m,dept,'doctor-1',doctor_name,doctor_specialty,doctor_registration,consultation_fee_paise,false) ON CONFLICT(organization_id,membership_id) DO UPDATE SET display_name=excluded.display_name RETURNING id INTO doctor_id;
 INSERT INTO hms.doctor_branches(organization_id,doctor_id,branch_id) VALUES(org,doctor_id,branch) ON CONFLICT DO NOTHING;
 END IF;
 END LOOP;
END $$;
COMMIT;
-- Verify each staff user's role. Then sign in with MFA, configure actual schedule/fee,
-- publish the verified doctor, generate slots, and enable booking from Admin Settings.
