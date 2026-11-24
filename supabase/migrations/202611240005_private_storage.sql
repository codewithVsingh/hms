-- Run only on Supabase, where storage.buckets exists. No object-access policies added.
BEGIN;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('hms-private-documents','hms-private-documents',false,10485760,ARRAY['application/pdf','image/jpeg','image/png'])
 ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='hms-private-documents' AND public) THEN
  RAISE EXCEPTION 'Existing hms-private-documents bucket is public; review manually';
 END IF;
END $$;
-- Review any pre-existing storage.objects policies; broad policies can undermine private-bucket access.
-- Future server flow must verify scope before creating signed upload/download URLs, scan uploads, and log access.
COMMIT;
