-- Run in development as migration owner. No real patient/payment records are created.
-- hms_book_self and hms_cancel_self are intentionally revoked by migration 018 (Phase 4);
-- verify_phase4.sql asserts that they are NOT callable by browser roles.
-- hms_staff_register is revoked by migration 023 (registration must run the duplicate check);
-- verify_duplicates.sql asserts that.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('hms_claim_order','hms_attach_order','hms_lookup_order','hms_capture_payment','hms_apply_refund') LOOP
 IF has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('authenticated',f.oid,'EXECUTE') OR NOT has_function_privilege('service_role',f.oid,'EXECUTE') THEN RAISE EXCEPTION 'Invalid gateway privilege: %',f.proname; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('hms_claim_order','hms_attach_order','hms_lookup_order','hms_capture_payment','hms_apply_refund'))<>5 THEN RAISE EXCEPTION 'Missing gateway functions'; END IF;
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND ((p.proname LIKE 'hms_staff_%' AND p.proname <> 'hms_staff_register') OR p.proname LIKE 'hms_admin_%' OR p.proname IN ('hms_my_bookings','hms_content_list','hms_content_save','hms_content_transition','hms_refund_claim','hms_refund_access','hms_refund_candidates','hms_change_status','hms_collect_offline','hms_clinical_draft')) LOOP
 IF has_function_privilege('anon',f.oid,'EXECUTE') OR NOT has_function_privilege('authenticated',f.oid,'EXECUTE') THEN RAISE EXCEPTION 'Invalid workforce/patient RPC privilege: %',f.proname; END IF;
 END LOOP;
 IF NOT has_function_privilege('anon','public.hms_catalog(text,text)','EXECUTE') OR NOT has_function_privilege('anon','public.hms_available_slots(text,text,uuid,date)','EXECUTE') OR NOT has_function_privilege('anon','public.hms_public_content(text)','EXECUTE') THEN RAISE EXCEPTION 'Missing public-only RPC'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='hms' AND indexname='booking_request_unique') OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='hms' AND indexname='one_gateway_order_per_invoice') OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='hms' AND indexname='full_refund_one_per_payment') THEN RAISE EXCEPTION 'Missing transaction uniqueness guard'; END IF;
 RAISE NOTICE 'Live static database privilege checks passed. Run staging integration and adversarial tests separately.';
END $$;
