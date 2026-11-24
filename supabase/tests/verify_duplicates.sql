-- Run as migration owner after migration 023. Static checks only; behaviour is covered by
-- supabase/tests/local/10_behaviour.sql (T15).
DO $$
DECLARE f record;
BEGIN
  -- Old entry points that skip the duplicate check / date of birth are closed to browsers.
  IF has_function_privilege('authenticated', 'public.hms_staff_register(uuid,uuid,text,text,date,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.hms_v4_book_self(text,text,uuid,text,text,uuid,text,boolean,bigint,integer)', 'EXECUTE')
  THEN RAISE EXCEPTION 'Legacy registration/booking RPC still callable by authenticated'; END IF;
  FOR f IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE 'hms_v7_%' LOOP
    IF has_function_privilege('anon', f.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
    THEN RAISE EXCEPTION 'Invalid duplicate/merge RPC privilege: %', f.proname; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'hms_v7_%') <> 11
  THEN RAISE EXCEPTION 'Missing duplicate/merge RPCs'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN RAISE EXCEPTION 'pg_trgm extension missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'hms' AND indexname = 'patient_merges_one_pending_per_patient_m')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'hms' AND indexname = 'patient_duplicate_flags_open_pair')
  THEN RAISE EXCEPTION 'Missing merge/flag uniqueness guard'; END IF;
  IF has_schema_privilege('authenticated', 'hms', 'USAGE') THEN RAISE EXCEPTION 'hms schema exposed'; END IF;
  RAISE NOTICE 'Duplicate-patient privilege checks passed.';
END $$;
