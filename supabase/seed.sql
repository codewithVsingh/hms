-- OPTIONAL: synthetic organization/branch only; no auth users, patients, credentials or payment data.
BEGIN;
INSERT INTO hms.organizations(id,slug,name) VALUES('11111111-1111-4111-8111-111111111111','aarogya-demo','Aarogya Care DEMO') ON CONFLICT(id) DO NOTHING;
INSERT INTO hms.branches(id,organization_id,code,name) VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','MAIN','Demo main branch') ON CONFLICT(id) DO NOTHING;
INSERT INTO hms.hospital_settings(organization_id,branch_id,booking_enabled,online_payment_enabled) VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',false,false) ON CONFLICT DO NOTHING;
COMMIT;
