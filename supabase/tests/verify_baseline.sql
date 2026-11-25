-- Run after migrations in development SQL editor. Raises if baseline access is not deny-by-default.
DO $$ DECLARE t record; BEGIN
 IF has_schema_privilege('anon','hms','USAGE') OR has_schema_privilege('authenticated','hms','USAGE') THEN RAISE EXCEPTION 'Unexpected client schema grant'; END IF;
 FOR t IN SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='hms' AND c.relkind='r' LOOP
 IF NOT t.relrowsecurity THEN RAISE EXCEPTION 'RLS disabled: %',t.relname; END IF;
 IF has_table_privilege('anon',format('hms.%I',t.relname),'SELECT') OR has_table_privilege('authenticated',format('hms.%I',t.relname),'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unexpected browser grant: %',t.relname; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM hms.role_permissions WHERE role_key='super_admin' AND permission_key LIKE 'clinical.%') THEN RAISE EXCEPTION 'Admin unexpectedly has clinical permissions'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='hms' AND indexname='one_live_appointment_per_slot') THEN RAISE EXCEPTION 'Missing slot uniqueness'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='hms-private-documents' AND NOT public) THEN RAISE EXCEPTION 'Private document bucket missing'; END IF;
 RAISE NOTICE 'Baseline checks passed. This does not certify live security.';
END $$;
