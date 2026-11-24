# Implementation tracker

Running record for the audit and hardening work, so any session can resume without repeating work. Business rules live in [BUSINESS_RULES.md](BUSINESS_RULES.md); update it with every rule change. Issue details: [GAP_ANALYSIS.md](GAP_ANALYSIS.md). Branch: `feature/hms-audit-security-hardening` (draft PR #1; not merged).

**Resume here:** next up is Phase 3, in this order:
1. HMS-018 duplicate patient detection (needs match-rule decision; propose first)
2. HMS-020 rate limiting
3. HMS-024 Hindi completion

Start a local DB with `supabase/tests/local/run.sh` and add a T-test for each change.

## Done

| Issue | Priority | Files | Solution | Tests | Verified |
|---|---|---|---|---|---|
| HMS-001 | P0 | `supabase/migrations/202611240012_operations_expansion.sql` | `AS day` alias; 012 can now apply | DB suite applies 001–019 | Local PG 16 + CI |
| HMS-002 | P0 | `supabase/tests/local/*`, `.github/workflows/ci.yml` | Shim, runner, behavioural tests, race test, CI job | T1–T11 | Local + CI |
| HMS-003 | P1 | `supabase/tests/verify_live.sql` | Aligned with migration 018 | verify scripts | Local + CI |
| HMS-004 | P1 | `supabase/migrations/202611250019_…sql` | Random 7-character unambiguous references | T3, T11 | Local + CI |
| HMS-005 | P1 | same | Append-only triggers on `audit_logs` | T11 | Local + CI |
| HMS-006 | P0 | `apps/portal/app/api/internal/maintenance/route.ts` | Independent steps, per-step result | Build + typecheck | On `main` (2857d4e) |
| HMS-007 | P1 | `tests/phase-one.spec.ts` | Locator filter | E2E | On `main` |
| HMS-008 | P1 | `pnpm-lock.yaml`, CI | Frozen lockfile | CI install | On `main` |
| HMS-009 | P2 | API routes v1/v2, inquiry | Object-only JSON bodies | Typecheck | On `main` |
| HMS-010 | P1 | `.github/workflows/*`, `.github/dependabot.yml`, `.gitleaks.toml` | Least privilege, audit, Gitleaks, CodeQL, Dependabot | CI runs | CI green |
| HMS-011 | P2 | `apps/portal/app/api/health/route.ts`, `lib/server/config-check.ts` | Public status, secret-gated detail | `tests/hardening.spec.ts` | Local E2E |
| HMS-012 | P2 | `apps/*/app/error.tsx` | Generic error boundary | Build | Local |
| HMS-013 | P2 | `apps/*/next.config.ts` | HSTS in production | Build | Local |
| HMS-014 | P3 | `apps/portal/app/not-found.tsx` | Mode-aware copy | E2E (existing) | Local |
| HMS-015 | P3 | `apps/portal/public/sw.js` | Clear all caches on activate | Static PWA tests | Local |
| HMS-019 | P2 | `supabase/migrations/202611250020_patient_search_audit.sql`, `apps/portal/features/live/workspace.tsx`, `extended.tsx` | Search audited (no search text stored); mobile and booking-reference search; 350 ms debounce instead of a request per keystroke | T12 | Local + CI |
| HMS-016 | P1 | `supabase/migrations/202611250021_doctor_unavailability.sql`, `apps/portal/app/api/v2/[...action]/route.ts`, `apps/portal/features/live/extended.tsx`, `apps/portal/lib/extended-nav.ts` | Leave recorded despite bookings (blocks new ones at once) with a reason; Affected bookings screen (call, reschedule, or hospital cancel with full refund); online refunds via admin approval/auto; desk refunds screen for billing; patient notified by existing triggers | T13, `tests/unavailability.spec.ts` | Local + CI |
| HMS-017 | P1 | `supabase/migrations/202611250022_prescription_corrections.sql`, `apps/portal/app/api/v3/[...action]/route.ts`, `apps/portal/features/live/prescription-corrections.tsx`, `extended.tsx`, `patient-history.tsx`, `lib/server/notifications.ts` | Issuer-only amendment within 72 h of first issue; versions kept; two-person withdrawal; paper recall list; content-free notifications; version history | T14, `tests/prescription-corrections.spec.ts` | Local + CI |
| UI | P2 | `apps/portal/app/portal.css` | Checkbox labels in panels were squeezed to one letter per line (also on the original issue form) | Screenshot check | Local |
| Docs | — | `docs/BUSINESS_RULES.md`, `.github/pull_request_template.md` | All business rules with enforcement and tests; decision log; PR checklist requires keeping it current | — | — |
| HMS-033 | P1 | `docs/BACKUP_AND_RECOVERY.md` | Procedure documented | — | Restore drill pending |
| Docs | — | `docs/*.md` (this set) | Audit, gap analysis, security, threat model, roles, env, DB, tests, readiness | — | — |

## Pending

| Issue | Priority | Plan | Dependency / manual configuration |
|---|---|---|---|
| HMS-018 | P1 | Duplicate candidates at registration; merge RPC with two-person review, audit; never automatic | Decision on match rules |
| HMS-020 | P2 | Edge rate limits (hosting WAF) or a DB-backed limiter for lookup/quote/upload | Hosting choice |
| HMS-021 | P2 | Optional nurse `vitals.write` | Hospital decision |
| HMS-022 | P2 | Daily cash close report; discounts with approval | Finance process |
| HMS-023 | P2 | Provider callbacks, in-app notifications | Provider accounts |
| HMS-024 | P2 | Complete Hindi catalogue | Native and clinical review |
| HMS-025–029 | P3 | See gap analysis | — |
| HMS-032 | P1 | Legal and compliance review | Hospital legal |
