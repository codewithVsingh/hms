-- Structural checks only. Run after migrations 001-018 in a test Supabase project.
DO $$ BEGIN
 IF to_regclass('hms.booking_cancellations') IS NULL OR to_regclass('hms.prescription_handover') IS NULL OR to_regclass('hms.paper_prescription_archive') IS NULL THEN RAISE EXCEPTION 'Cancellation and prescription-history tables absent'; END IF;
 IF has_function_privilege('anon','public.hms_v4_find_booking(text,text,text,text)','EXECUTE') OR has_function_privilege('anon','public.hms_v4_cancel(uuid,bigint,bigint,bigint,integer,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous booking access'; END IF;
 IF has_function_privilege('authenticated','public.hms_cancel_self(uuid)','EXECUTE') OR has_function_privilege('authenticated','public.hms_book_self(text,text,uuid,text,text,uuid,text,boolean,bigint)','EXECUTE') THEN RAISE EXCEPTION 'Legacy cancellation/booking bypass'; END IF;
 IF has_function_privilege('authenticated','public.hms_v4_claim_requested_refund(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Refund service RPC exposed'; END IF;
 IF has_table_privilege('authenticated','hms.booking_cancellations','SELECT') OR has_table_privilege('authenticated','hms.paper_prescription_archive','SELECT') THEN RAISE EXCEPTION 'Private clinical/refund data exposed'; END IF;
 IF hms_private.base36(36) <> '10' OR hms_private.base36(35) <> 'Z' THEN RAISE EXCEPTION 'Invalid reference conversion'; END IF;
END $$;
