-- Execute after 001-016 in a new staging project. These assertions do not certify clinical/payment correctness.
DO $$ BEGIN
 IF has_function_privilege('anon','public.hms_v3_care(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous clinical access'; END IF;
 IF has_function_privilege('authenticated','public.hms_v3_document_add(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,boolean)','EXECUTE') THEN RAISE EXCEPTION 'Unsafe document creation grant'; END IF;
 IF has_function_privilege('authenticated','public.hms_v3_reconciliation_candidates(text,text)','EXECUTE') THEN RAISE EXCEPTION 'Unsafe reconciliation grant'; END IF;
 IF has_function_privilege('anon','public.hms_v3_inquiry_submit(text,text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Bypass of CAPTCHA server'; END IF;
 IF has_function_privilege('authenticated','public.hms_v3_claim_notifications(text,text,text[])','EXECUTE') THEN RAISE EXCEPTION 'Unsafe job claim grant'; END IF;
 IF NOT has_function_privilege('authenticated','public.hms_v3_reschedule(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Missing reschedule grant'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='hms' AND indexname='hms_queue_unique') THEN RAISE EXCEPTION 'Missing token uniqueness'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='hms' AND c.relname='patient_history' AND c.relrowsecurity) THEN RAISE EXCEPTION 'Missing history RLS'; END IF;
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='hms-private-documents' AND public) THEN RAISE EXCEPTION 'Public medical bucket'; END IF;
END $$;
SELECT 'Clinical, notification and document static database assertions passed; execute live test matrix next' AS result;
