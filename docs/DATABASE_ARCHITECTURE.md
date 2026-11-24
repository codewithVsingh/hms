# Database architecture

PostgreSQL on Supabase. 46 tables in the private `hms` schema, helper functions in `hms_private`, and a narrow set of RPCs in `public`. Browser roles (`anon`, `authenticated`) have **no** access to `hms`/`hms_private`; every read and write goes through a `public.hms_*` function that checks permission or ownership. RLS is enabled on every table as a second layer.

## Schemas

| Schema | Contents | Browser access |
|---|---|---|
| `hms` | All data tables | None (no USAGE) |
| `hms_private` | Permission helpers, booking engine, generators, triggers | None (EXECUTE revoked) |
| `public` | `hms_*` RPCs: 4 anonymous (catalog, slots, public content, cancellation policy), 55 for signed-in users, the rest for `service_role` only | Per function |

## Main tables by domain

- **Tenancy and people:** organizations, branches, hospital_settings, departments, profiles, memberships, membership_branches, roles, permissions, role_permissions, user_roles, doctors, doctor_branches
- **Patients:** patients (UHID `mrn`, e.g. `PT-000123`), patient_owners (verified phone account ↔ patient), patient_contacts, patient_branches, consent_records, notification_preferences
- **Scheduling:** doctor_schedules, doctor_leaves, appointment_slots, appointments (reference `BK-…`), appointment_status_history, appointment_moves, queue_counters, care_assignments
- **Clinical:** encounters, clinical_notes, vitals, diagnoses, patient_history, prescriptions, prescription_items, prescription_handover, paper_prescription_archive, patient_documents
- **Finance:** invoices, invoice_items, payment_orders, payments, refunds, booking_cancellations, webhook_events
- **Operations:** notification_jobs, public_inquiries, content_entries, audit_logs

## Integrity rules (selected)

- Money is `bigint` paise everywhere; CHECK constraints keep amounts non-negative. Each cancellation stores `paid = deduction + refund`.
- `one_live_appointment_per_slot`: a unique partial index, so a slot can hold only one live appointment.
- `booking_request_unique`: (user, request_id) makes booking retries idempotent.
- `appointments (organization_id, reference)` and `patients (organization_id, mrn)` are unique.
- One gateway order per invoice; one full refund per payment; webhook events unique per provider event ID.
- Lock order for payments and cancellations: slot → appointment → invoice → order/payment.
- Times are stored as `timestamptz` (UTC). The branch `timezone` (default `Asia/Kolkata`) is used for schedules, daily queues and reports.
- `audit_logs` is append-only (migration 019).

## Identifiers

| Identifier | Format | Generation |
|---|---|---|
| Booking reference | `BK-` + 7 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` | Random (migration 019); uniqueness checked and enforced. Older `BK-000000X` references remain valid. |
| Patient number (UHID) | `PT-` + ≥ 6 digits | Sequence (migration 017). A deliberate choice: familiar to hospital staff and separate from booking references. |
| Internal keys | UUID | Never shown as the user-facing reference |

## Migration order

Apply in filename order. Never edit a migration that has been applied; add a new one.

| # | File | Purpose |
|---|---|---|
| 001 | `202611240001_foundation` | Organizations, branches, roles, doctors, patients |
| 002 | `…0002_appointments_clinical` | Slots, appointments, clinical tables, collision constraints |
| 003 | `…0003_finance_cms_audit` | Invoices, payments, refunds, CMS, audit |
| 004 | `…0004_rbac_rls` | Permissions, RLS, helpers |
| 005 | `…0005_private_storage` | Private document bucket |
| 006 | `…0006_booking_engine` | Catalog, availability, slot generation, booking |
| 007 | `…0007_payment_engine` | Order claim, attach, capture, reconciliation |
| 008 | `…0008_operations` | Staff context (MFA), registration, queues, offline payment, drafts |
| 009 | `…0009_admin_content` | CMS workflow, doctor and schedule admin |
| 010 | `…0010_refund_review` | Staff cancellation, admin refunds |
| 011 | `…0011_clinical_records` | Vitals, history, prescriptions, patient access |
| 012 | `…0012_operations_expansion` | Rescheduling, OPD tokens, leave, reports (**fixed in this branch**: could not apply before) |
| 013 | `…0013_notifications` | Opt-in contacts, notification jobs, maintenance |
| 014 | `…0014_team_and_documents` | Invitations, roles, documents |
| 015 | `…0015_patient_and_public` | Demographic corrections, callback inquiries |
| 016 | `…0016_reconciliation_and_events` | Reconciliation candidates, event notifications |
| 017 | `…0017_patient_numbers_and_history` | Short references, doctor timeline, prescription register |
| 018 | `…0018_cancellation_policy` | Policy versions, cancellation ledger, policy refunds |
| 019 | `202611250019_random_references_and_audit_guard` | Random booking references, append-only audit log |
| 020 | `202611250020_patient_search_audit` | Patient search by mobile/reference; searches audited |
| 021 | `202611250021_doctor_unavailability` | Leave reasons, affected-bookings list, hospital cancellation with full refund, desk refunds |

**Existing databases:** if migration 012 was attempted before, it failed and rolled back completely. Apply the corrected 012, then 013 onward in order. Use the Supabase migration history (`supabase_migrations.schema_migrations`) to see exactly what is applied.

## Testing

`supabase/tests/local/run.sh` builds a fresh database (Supabase shim + all migrations), runs the four `verify_*.sql` scripts, the behavioural suite (`10_behaviour.sql`, T1–T9, T11–T13) and the concurrency race (`20_concurrency.sh`). CI runs it on `postgres:16` for every pull request. The shim in `tests/local/00_supabase_shim.sql` is for local and CI use only. Never apply it to a Supabase project.
