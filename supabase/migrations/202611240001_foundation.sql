-- Phase 1 schema proposal. Apply to a NEW Supabase development project first.
-- The hms schema is intentionally not exposed to the browser/Data API.
BEGIN;
CREATE SCHEMA IF NOT EXISTS hms;
REVOKE ALL ON SCHEMA hms FROM PUBLIC, anon, authenticated;
CREATE SCHEMA IF NOT EXISTS hms_private;
REVOKE ALL ON SCHEMA hms_private FROM PUBLIC, anon, authenticated;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
SET LOCAL search_path = hms, extensions, public, pg_catalog;
CREATE TABLE hms.organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
 name text NOT NULL, timezone text NOT NULL DEFAULT 'Asia/Kolkata', active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hms.branches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES hms.organizations(id),
 code text NOT NULL, name text NOT NULL, timezone text NOT NULL DEFAULT 'Asia/Kolkata', active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id), UNIQUE(organization_id,code)
);
CREATE TABLE hms.departments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES hms.organizations(id),
 name text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE(organization_id,id), UNIQUE(organization_id,name)
);
CREATE TABLE hms.profiles (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 display_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hms.memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES hms.organizations(id),
 user_id uuid NOT NULL REFERENCES hms.profiles(user_id), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id), UNIQUE(organization_id,user_id)
);
CREATE TABLE hms.membership_branches (
 organization_id uuid NOT NULL, membership_id uuid NOT NULL, branch_id uuid NOT NULL,
 PRIMARY KEY(organization_id,membership_id,branch_id),
 FOREIGN KEY(organization_id,membership_id) REFERENCES hms.memberships(organization_id,id),
 FOREIGN KEY(organization_id,branch_id) REFERENCES hms.branches(organization_id,id)
);
CREATE TABLE hms.roles (key text PRIMARY KEY, label text NOT NULL, description text NOT NULL);
CREATE TABLE hms.permissions (key text PRIMARY KEY, description text NOT NULL);
CREATE TABLE hms.role_permissions (role_key text REFERENCES hms.roles(key),permission_key text REFERENCES hms.permissions(key),PRIMARY KEY(role_key,permission_key));
-- Roles are branch-scoped: no implicit all-branch access for admins.
CREATE TABLE hms.user_roles (
 organization_id uuid NOT NULL, membership_id uuid NOT NULL, branch_id uuid NOT NULL,
 role_key text NOT NULL REFERENCES hms.roles(key), PRIMARY KEY(organization_id,membership_id,branch_id,role_key),
 FOREIGN KEY(organization_id,membership_id,branch_id) REFERENCES hms.membership_branches(organization_id,membership_id,branch_id)
);
CREATE TABLE hms.doctors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES hms.organizations(id),
 membership_id uuid NOT NULL, department_id uuid, public_slug text NOT NULL, display_name text NOT NULL,
 registration_number text, specialty text NOT NULL, bio text, active boolean NOT NULL DEFAULT true,
 published boolean NOT NULL DEFAULT false, fee_paise bigint NOT NULL CHECK(fee_paise>=0),
 UNIQUE(organization_id,id), UNIQUE(organization_id,membership_id), UNIQUE(organization_id,public_slug),
 FOREIGN KEY(organization_id,membership_id) REFERENCES hms.memberships(organization_id,id),
 FOREIGN KEY(organization_id,department_id) REFERENCES hms.departments(organization_id,id)
);
CREATE TABLE hms.doctor_branches (
 organization_id uuid NOT NULL, doctor_id uuid NOT NULL, branch_id uuid NOT NULL, active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(organization_id,doctor_id,branch_id),
 FOREIGN KEY(organization_id,doctor_id) REFERENCES hms.doctors(organization_id,id),
 FOREIGN KEY(organization_id,branch_id) REFERENCES hms.branches(organization_id,id)
);
CREATE TABLE hms.doctor_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, doctor_id uuid NOT NULL, branch_id uuid NOT NULL,
 weekday smallint NOT NULL CHECK(weekday BETWEEN 0 AND 6), start_local time NOT NULL, end_local time NOT NULL,
 slot_minutes smallint NOT NULL DEFAULT 30 CHECK(slot_minutes BETWEEN 5 AND 180), active boolean NOT NULL DEFAULT true,
 CHECK(start_local<end_local), FOREIGN KEY(organization_id,doctor_id,branch_id) REFERENCES hms.doctor_branches(organization_id,doctor_id,branch_id)
);
CREATE TABLE hms.doctor_leaves (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, doctor_id uuid NOT NULL,
 branch_id uuid NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 CHECK(starts_at<ends_at), FOREIGN KEY(organization_id,doctor_id,branch_id) REFERENCES hms.doctor_branches(organization_id,doctor_id,branch_id)
);
CREATE TABLE hms.patients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES hms.organizations(id),
 mrn text NOT NULL, full_name text NOT NULL, birth_date date, gender text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,mrn)
);
CREATE TABLE hms.patient_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, patient_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('phone','email','guardian_phone','guardian_email')),
 contact_value text NOT NULL, verified_at timestamptz,
 FOREIGN KEY(organization_id,patient_id) REFERENCES hms.patients(organization_id,id)
);
-- Patients are organization-level; branch association is explicit.
CREATE TABLE hms.patient_branches (
 organization_id uuid NOT NULL, patient_id uuid NOT NULL, branch_id uuid NOT NULL,
 PRIMARY KEY(organization_id,patient_id,branch_id),
 FOREIGN KEY(organization_id,patient_id) REFERENCES hms.patients(organization_id,id),
 FOREIGN KEY(organization_id,branch_id) REFERENCES hms.branches(organization_id,id)
);
CREATE TABLE hms.care_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_id uuid NOT NULL, patient_id uuid NOT NULL, doctor_id uuid NOT NULL,
 granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 FOREIGN KEY(organization_id,patient_id,branch_id) REFERENCES hms.patient_branches(organization_id,patient_id,branch_id),
 FOREIGN KEY(organization_id,doctor_id,branch_id) REFERENCES hms.doctor_branches(organization_id,doctor_id,branch_id),
 CHECK(revoked_at IS NULL OR revoked_at>=granted_at)
);
CREATE UNIQUE INDEX care_assignment_active_unique ON hms.care_assignments(organization_id,branch_id,patient_id,doctor_id) WHERE revoked_at IS NULL;
CREATE INDEX memberships_user_idx ON hms.memberships(user_id,organization_id) WHERE active;
CREATE INDEX patient_branch_lookup ON hms.patient_branches(organization_id,branch_id,patient_id);
COMMIT;
