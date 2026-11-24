# Backup and recovery

Medical records, payments and the audit trail must survive accidental deletion, bad migrations and provider incidents. Most of this is operational and must be set up and rehearsed by the hospital. The code can't do it alone.

## What to protect

| Data | Where | Notes |
|---|---|---|
| Database (`hms` schema: patients, appointments, clinical records, prescriptions, invoices, payments, refunds, audit) | Supabase Postgres | Primary system of record |
| Medical documents and paper prescription scans | Supabase Storage bucket `hms-private-documents` | **Not** included in database backups. Back up separately. |
| Auth users | Supabase `auth` schema | Included in database backups |
| Configuration | Hosting environment variables | Keep an encrypted copy in a password manager; never in git |
| Code and migrations | GitHub | Migrations are the schema history |

## Targets (proposed; confirm with the hospital)

- RPO (maximum data loss): 5 minutes, using point-in-time recovery.
- RTO (time to restore service): 4 hours.
- Retention: daily backups for 30 days. Long-term retention follows the hospital's medical-records retention schedule (set by legal counsel).

## Setup

1. Enable **Point-in-Time Recovery** on the Supabase project (paid plan).
2. Schedule a **nightly logical backup** to storage the hospital controls (e.g. a separate cloud account):
   `pg_dump --format=custom --no-owner --schema=hms --schema=hms_private --schema=auth "$DATABASE_URL" > hms-$(date +%F).dump`
   Encrypt the file, and restrict who can read it as tightly as production.
3. Copy the storage bucket nightly (Supabase S3-compatible API, or a scheduled job that copies new objects). Keep object paths unchanged, because `hms.patient_documents` refers to them.
4. Alert if a backup job fails, or if the newest backup is older than 26 hours.

## Restore drill (do before launch, then quarterly)

1. Create a **new** Supabase project. Never restore over production.
2. Restore the latest dump: `pg_restore --no-owner --dbname "$RESTORE_URL" hms-YYYY-MM-DD.dump`.
3. Run `supabase/tests/verify_*.sql`. All must pass.
4. Restore the storage objects; spot-check that five documents open through the portal.
5. Point a staging deployment at the restored project. Check sign-in, today's appointments, a patient timeline and a receipt.
6. Record the time taken against the RTO.

## Rollback of a bad release

- **App:** redeploy the previous build (Vercel "Promote to production" on the previous deployment).
- **Database:** migrations are forward-only. Write a new corrective migration. For destructive mistakes, restore with point-in-time recovery into a new project and repoint after review. Never edit an applied migration.
- Before every migration: take a manual backup and apply it to staging first.

## Audit-log retention

`hms.audit_logs` is append-only (migration 019). Applications cannot change or delete it. If the retention schedule requires purging old entries, a database owner does it as a recorded maintenance change:
1. Export the entries to be purged to the long-term archive.
2. In one transaction: `ALTER TABLE hms.audit_logs DISABLE TRIGGER audit_logs_no_update_delete;`, delete by `occurred_at` cut-off, then re-enable the trigger.
3. Record who did it, why and the row count in the change log.

## Incident response (summary)

Contain (revoke keys, disable accounts) → assess what data was affected → notify as required by law (DPDP Act 2023; healthcare regulators) → restore → review. Name an incident owner and keep contact details in the runbook.
