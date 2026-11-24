# Supabase database package — Phase 4

Apply in a **new development Supabase project first**. Do not paste all scripts repeatedly into a production database. SQL is versioned and assumes the Supabase-provided auth/storage schemas and roles. The `hms` and `hms_private` schemas must stay unexposed and denied to browser roles. Public RPCs are intentionally narrow; do not grant broad table access or disable RLS to solve connectivity problems.

## Ordered migrations

| File suffix | Responsibility |
|---|---|
| 0001_foundation | Organization, branch, roles, doctors, patients |
| 0002_appointments_clinical | Slot and clinical data, collision constraints |
| 0003_finance_cms_audit | Invoices, payments, refunds, CMS, audit |
| 0004_rbac_rls | Baseline permissions, RLS and helpers |
| 0005_private_storage | Private storage bucket |
| 0006_booking_engine | Public catalog/availability, slot generation, patient ownership, transactional booking, history |
| 0007_payment_engine | Trusted server order claim/attachment, capture and reconciliation |
| 0008_operations | Workforce AAL2 context, registration, scheduling, queues, payment, clinical drafts and cancellation |
| 0009_admin_content | CMS review/publish, public content, doctor and schedule admin controls |
| 0010_refund_review | Staff cancellation and admin full refund claims/settlement |

| 0011_clinical_records | Vitals, history, prescription attestation, patient access |
| 0012_operations_expansion | Rescheduling, OPD tokens, leave and aggregate reports |
| 0013_notifications | Verified opt-in contacts, durable jobs, slot maintenance |
| 0014_team_and_documents | Branch invitations, role assignments, private documents |
| 0015_patient_and_public | Demographic corrections, callback inquiries, move slots |
| 0016_reconciliation_and_events | Read-only payment reconciliation and event notifications |
| 0017_patient_numbers_and_history | Short references, doctor timeline, reception prescription register |
| 0018_cancellation_policy | Policy versions, verified lookup, cancellation ledger and policy refunds |
| 0019_random_references_and_audit_guard | Random unambiguous booking references, append-only audit log (file `202611250019_…`) |
| 0020_patient_search_audit | Patient search by mobile and booking reference; searches audited (file `202611250020_…`) |
| 0021_doctor_unavailability | Leave reasons, affected bookings, hospital cancellation with full refund, desk refunds (file `202611250021_…`) |
| 0022_prescription_corrections | Prescription versions, amendment window, two-person withdrawal, paper recall (file `202611250022_…`) |

Actual filenames begin with `202611240001` through `202611240018`, then `202611250019`–`202611250022`. For a fresh database apply all twenty-two in order. Existing Phase 3 database: apply only 017–022. Existing Phase 2 database: 011–022; Phase 1: 006–022, provided previous migrations are unchanged. Use migration history and backups, not blind reapplication. Original 001–010 are preserved. Migration 012 contained a syntax error that made it impossible to apply; it was corrected in place (no database can have recorded it as applied) — if you attempted it before, simply apply it now and continue with 013+.

## Automated database tests

`tests/local/run.sh` creates a disposable PostgreSQL database, applies a Supabase role/schema shim and all migrations, runs the `verify_*.sql` scripts, behavioural security tests and a concurrent-booking race. CI runs it on every pull request. Never run it against a real Supabase project. See `../docs/DATABASE_ARCHITECTURE.md` and `../docs/TEST_REPORT.md`.

1. Apply migrations using Supabase CLI (recommended) or SQL Editor one file at a time.
2. Run `tests/verify_baseline.sql`, then `tests/verify_live.sql`, then `tests/verify_phase3.sql` and `tests/verify_phase4.sql`. These check privileges and key schema safeguards, not full functional/security certification.
3. Invite/create the actual administrator, doctor and receptionist in Supabase Auth. Configure staff password policy and TOTP MFA. Enable SMS phone auth and configure a supported provider plus Turnstile CAPTCHA. Configure signup and auth rate limits.
4. Edit all placeholders and approved fee in `setup/01_provision_hospital.sql`; execute once. It provisions one organization/branch, one doctor, one administrator, and receptionist + billing roles. Use the same pattern for additional doctors/staff, and assign least privilege. Keep booking and online payment disabled initially.
5. In the live portal, sign in with email/password and MFA. Set real doctor bio/registration in DB if needed, publish verified doctor, create schedules, generate slots. Add/approve/publish actual privacy/booking/refund and hospital pages. Connect payment test keys and webhook before enabling any checkout.
6. Test with synthetic patients and test payment accounts only. Use `docs/QA-PHASE2.md` acceptance matrix.

Optional `seed.sql` creates only a disabled fictional organization and branch. It is unnecessary for real provisioning.

Notes: one verified phone-auth user maps to one self-booking patient in each organization. Staff registration remains separate until verified identity linking/merge is implemented. Do not auto-match patients using names or phone alone. Existing appointment slots are preserved; disabling a schedule closes availability for that inactive schedule, and existing reserved appointments remain for operator review. Changing slot duration or reactivating overlapping inventory can require explicit reconciliation. Phase 3 adds authorized document downloads, scanner-gated clinician uploads, and opt-in notification adapters; provider accounts, scanner and worker scheduling must be connected and tested. See `../docs/PHASE3-HANDOVER.md`.
