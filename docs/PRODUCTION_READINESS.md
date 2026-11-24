# Production readiness

## Verdict: READY FOR LOCAL DEVELOPMENT

It is not yet ready for staging or production. Database security, payment integrity and booking concurrency are now verified on a real PostgreSQL database. But the system has never run against a real Supabase project, Razorpay test mode or the hospital's hosting. Several launch-blocking items (below) are also open. The next milestone is **READY FOR STAGING**, which needs the "Before staging" list.

## Before staging

- [ ] Create a dedicated staging Supabase project; apply migrations 001–022; all `verify_*.sql` pass
- [ ] Complete the Supabase Auth / storage checklist in [SECURITY_HARDENING.md](SECURITY_HARDENING.md)
- [ ] Deploy website and portal to staging hosting with the environment from [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md); `/api/health` (with secret) reports `mode: live` and the expected checks
- [ ] Razorpay **test** keys and webhook configured; run book → pay → webhook → cancel → refund end to end
- [ ] Schedule the maintenance endpoint (every 5–10 min) with `CRON_SECRET`
- [ ] Provision real staff accounts (MFA enrolled) with synthetic patients only

## Before production (launch blockers)

| Item | Ref | Owner |
|---|---|---|
| Duplicate patient detection and reviewed merge | HMS-018 | Engineering |
| Edge rate limiting on `/api/*` | HMS-020 | Engineering / hosting |
| Notification providers: DLT-registered SMS templates, WhatsApp templates, delivery monitoring | HMS-023 | Hospital + engineering |
| Malware scanner for uploads | — | Hospital / vendor |
| Privacy notice, terms, cancellation and refund policy approved by legal; consent wording; DPDP Act 2023 obligations (notice, consent, grievance officer, breach reporting) | HMS-032 | Hospital legal |
| Medical-records retention schedule; clinical-establishment and prescription regulations review | HMS-032 | Hospital legal + medical |
| Backup, point-in-time recovery and a successful restore drill | HMS-033 | Operations |
| Penetration test against staging | — | Independent tester |
| Staff training and downtime (paper) procedure | — | Hospital |
| Hindi review of patient-facing flows by a native speaker and a clinician | HMS-024 | Hospital |

## What is already solid

Access control and tenant isolation in the database; MFA enforcement for staff; payment and refund integrity; booking concurrency; audit immutability; privacy-safe PWA; CI with build, lint, type, E2E, database and security scanning. Evidence: [TEST_REPORT.md](TEST_REPORT.md).

No formal regulatory compliance is claimed. That requires independent legal and security review.
