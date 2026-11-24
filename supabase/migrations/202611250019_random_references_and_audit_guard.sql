BEGIN;
-- 019: non-sequential booking references and an append-only audit log.
--
-- 1. Booking references were BK- + base36(sequence): BK-0000001, BK-0000002, ...
--    That is guessable and discloses booking volume. New references use 7 random characters
--    from an alphabet without easily confused characters (no 0/O, 1/I/L), e.g. BK-7K2M9QX.
--    31^7 (about 27.5 billion) combinations; uniqueness is still enforced by the existing
--    UNIQUE (organization_id, reference) constraint and checked before insert.
--    References are identifiers, not secrets: lookups still require the verified owner.
--    Existing references (old BK-/APT- formats) stay valid and are not rewritten.
-- 2. hms.audit_logs becomes append-only: UPDATE, DELETE and TRUNCATE raise an error for every
--    role. Retention purges must be an explicit, reviewed owner operation (see
--    docs/BACKUP_AND_RECOVERY.md), not something application code can do.

CREATE FUNCTION hms_private.random_reference(p_length integer) RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; -- 31 symbols
  result text := '';
  raw bytea;
  b integer;
  i integer;
BEGIN
  IF p_length IS NULL OR p_length NOT BETWEEN 4 AND 16 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  WHILE length(result) < p_length LOOP
    raw := uuid_send(gen_random_uuid());
    -- Skip the UUID version/variant bytes (6 and 8); use rejection sampling to avoid modulo bias.
    FOR i IN 0..15 LOOP
      CONTINUE WHEN i IN (6, 8);
      b := get_byte(raw, i);
      CONTINUE WHEN b >= 248; -- 248 = 31 * 8
      result := result || substr(alphabet, (b % 31) + 1, 1);
      EXIT WHEN length(result) = p_length;
    END LOOP;
  END LOOP;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION hms_private.assign_short_booking() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE attempts integer := 0;
BEGIN
  IF NEW.reference ~ '^APT-[A-F0-9]{32}$' THEN
    LOOP
      attempts := attempts + 1;
      NEW.reference := 'BK-' || hms_private.random_reference(7);
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM hms.appointments WHERE organization_id = NEW.organization_id AND reference = NEW.reference);
      IF attempts >= 20 THEN RAISE EXCEPTION 'REFERENCE_GENERATION_FAILED'; END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION hms_private.audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE' USING HINT = 'Audit records cannot be changed or deleted by the application.';
END $$;
CREATE TRIGGER audit_logs_no_update_delete BEFORE UPDATE OR DELETE ON hms.audit_logs
  FOR EACH ROW EXECUTE FUNCTION hms_private.audit_logs_append_only();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON hms.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION hms_private.audit_logs_append_only();

-- The booking-number sequence is no longer used for new references; kept so that existing
-- migration history and any external references to it remain valid.
COMMENT ON SEQUENCE hms_private.booking_number_seq IS 'Unused since migration 019 (random references).';

REVOKE ALL ON FUNCTION hms_private.random_reference(integer), hms_private.audit_logs_append_only() FROM PUBLIC, anon, authenticated;
COMMIT;
