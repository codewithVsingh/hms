---
name: hms-role-security-review
description: Review HMS code, API routes, SQL migrations or a branch for role/authorization flaws across patient, doctor, reception/staff (receptionist, billing, nurse, content_manager), super_admin, cron/webhook and anonymous surfaces — missing guards, ownership/IDOR gaps, service-role misuse, RLS and SECURITY DEFINER holes, PHI over-sharing, demo-mode leaks. Use when asked to review auth/permissions/RLS, check "can role X reach Y", audit a new or changed /api/v1|v2|v3 handler or migration, or before merging anything touching auth, payments, refunds, clinical records or documents. Read-only; does not fix unless asked.
---

# HMS Role & Permission Security Review

Project-specific review of **who can do what** in HMS (hospital management: website + patient/staff portal + Supabase). For a full adversarial audit use `security-audit`; for general hardening use `security-and-hardening`; for RLS/Postgres traps use `supabase` and `supabase-postgres-best-practices`. This skill supplies HMS's real principals, guard helpers and review order. Rules in `CLAUDE.md` win over anything here.

## Ground rules (read-only by default)
- Do not edit code, apply SQL/migrations, call any live service, or change env/flags. Report findings; fix only if the user asks, as a separate step.
- DB evidence only from migration files (`supabase/migrations/`), `supabase/tests/verify_*.sql`, or read-only queries the owner has approved on a **dev/staging** Supabase project. Never touch a production project.
- Never print secrets (service-role key, Razorpay keys/webhook secret, `CRON_SECRET`, `HMS_PRIVATE_SCANNER_TOKEN`, Turnstile secret) or real patient data. Use dummy principals; redact evidence.
- **Code ≠ deployed.** A migration file proves nothing about a given database. Label each DB-side conclusion `code-only`, `staging-verified` or `prod-unverified`.
- **Demo mode is not a security boundary.** With `HMS_DEMO_MODE=true` (or `NODE_ENV=development` unless `HMS_DEMO_MODE=false`) any role page is reachable by design and `/api/v*` return 503. Authorization can only be judged from code/SQL, or from a run with `HMS_DEMO_MODE=false` against a dev Supabase project with synthetic data.

## Principals and where they are enforced
Full table in [references/auth-surfaces.md](references/auth-surfaces.md). Summary:
- Auth = Supabase Auth. Patients: phone OTP (account without workforce membership). Staff: email+password **plus TOTP (AAL2)**, then DB-level active membership and role/branch permission.
- `apps/portal/proxy.ts` only refreshes the session cookie and sets `no-store`; it does **not** authorize and does **not** cover `/api/**`. Real checks are in (a) `app/[role]/[[...section]]/page.tsx` (server-side `staffContext` + role gate, redirect to `/login`) and (b) each `/api/v1|v2|v3` handler (`currentUser`, `staffContext`) and (c) the SQL functions, which are the **final authorization boundary**.
- Two Supabase clients: `sessionClient()` (user JWT, RLS applies) and `serviceClient()` (service role, bypasses RLS: only the handler's own checks protect it).

## Procedure
1. **Scope.** Diff review (`git diff <base>...HEAD`), a named area, or a whole-surface sweep. State which.
2. **Enumerate entry points** in scope: every branch of `apps/portal/app/api/{v1,v2,v3}/[...action]/route.ts` (they are catch-all routes: each `action === '...'` / `path === '...'` is a separate endpoint, GET and POST separately), `api/internal/maintenance`, `api/public/inquiry`, `app/auth/{callback,confirm}`, server-component pages that fetch data, SQL RPCs (`public.hms_*`), storage bucket `hms-private-documents`.
3. **Per endpoint, answer in order** (any "no" is a finding candidate):
   1. *Authenticated?* Is `currentUser`/`staffContext` called **before** any data access or side effect, and does it use `auth.getUser()` (verified) rather than trusting a cookie/`getSession`?
   2. *Right principal & permission?* Staff routes must go through `staffContext` **and** the RPC must check the specific permission (`hms_private.has_permission(org, branch, 'x.y')`), not merely "is staff". Doctor routes: assigned-care only (`has_care_assignment`, `is_assigned_doctor`). `super_admin` has no implicit clinical rights.
   3. *AAL2 / MFA?* Staff-only RPCs must require `auth.jwt()->>'aal'='aal2'` (see migration 008). A staff route reachable with an AAL1 session is a finding.
   4. *Ownership / IDOR?* For ids from URL/query/body (`appointmentId`, `id`, `orderId`, `mrn`, document `id`, `p_member`): does the SQL scope to `auth.uid()` / branch / assignment, or is the id trusted? Patient endpoints must only return the caller's own rows (`hms_my_bookings`, `hms_v3_patient_records`, documents, invoices, `hms_v4_find_booking` reference+identity).
   5. *Identity or money from the body?* `userId`, `role(s)`, `member`, `amount`, `fee`, `status`, `branch/org` taken from the request instead of session/server computation? Fee must be server-priced (`FEE_CHANGED`), org/branch from `scope()`/`staffContext`.
   6. *Service role.* Where `serviceClient()` is used (document download signed URL, document upload, invite link, payment settlement), is the preceding user-scoped RPC the thing that proves access (`hms_v3_document_access` before `createSignedUrl`)? Is the signed URL short-lived? Is the storage path derived from a verified record, never from user input?
   7. *CSRF.* Every state-changing POST must call `sameOrigin(req)`/`origin(req)` (exact `NEXT_PUBLIC_PORTAL_URL` origin) **except** the signature-verified Razorpay webhook. Check new routes did not skip it.
   8. *Response over-sharing.* PHI, other patients' rows, internal ids, stack/SQL errors? Errors must map through the safe `errors` table, not leak `error.message`. Responses must be `Cache-Control: private, no-store`.
   9. *Enumeration & abuse.* Booking reference + identity lookup, OTP/recovery/inquiry endpoints: captcha (Turnstile) present, generic errors, rate limits (Supabase-side), no "exists?" oracle, `BOOKING_LIMIT`.
   10. *Failure semantics.* Unauthenticated 401, forbidden 403, missing config 503 (`CONFIGURATION_REQUIRED`) — never fail-open. Cron/maintenance: secret ≥32 chars, constant-time compare, `HMS_DEMO_MODE==='false'` required.
   11. *Payments.* Webhook: raw-body HMAC verified before any state change; event id persisted (idempotent); amount/order/currency matched to the DB; settlement/refund RPCs granted to `service_role` only; test/live key modes cannot mix (`allowedPaymentKey`).
4. **Database layer** (when migrations/policies are in scope): RLS enabled on every `hms.*` table; no `USING (true)`/`OR true` on sensitive reads; UPDATE has `USING` **and** `WITH CHECK`; `hms_private` functions revoked from `PUBLIC, anon, authenticated`; every new `SECURITY DEFINER` function has `SET search_path=''`, an explicit `REVOKE ALL … FROM PUBLIC, anon, authenticated`, then a deliberate `GRANT EXECUTE` (to `authenticated` only with an in-function auth/permission check, to `service_role` for settlement/maintenance); public functions callable by `anon` are limited to the published-catalog trio (`hms_catalog`, `hms_available_slots`, `hms_public_content`); storage bucket `hms-private-documents` private; audit rows append-only; clinical versions immutable once completed.
5. **Client-only gates.** Hidden buttons, role checks in React, `localStorage`, `NEXT_PUBLIC_*` as controls are not controls. Confirm the server/SQL enforces the same rule. The `roleNav`/`demo.ts` data must never ship real data.
6. **Cross-role scenarios** (walk at least those relevant to the area): patient A → patient B's booking/invoice/document/records; patient → any `staff/*` or `v2|v3` staff action; receptionist → clinical notes/prescriptions/refund approval/role changes; billing → clinical data; nurse/doctor → unassigned patient; doctor → another doctor's patients; content_manager → publish (needs `cms.publish`, super_admin only); super_admin → clinical records (should be denied); staff with AAL1 session; deactivated membership or revoked role still working; cross-branch/org access; anonymous → anything but catalog/slots/public content/inquiry/OTP.
7. **Run the existing safety nets** (read-only, fast) and report exactly what passed/failed: `pnpm test:security` (static SQL/route/PWA/payment guards in `tests/security-static.test.cjs`); `supabase/tests/verify_baseline.sql`, `verify_live.sql`, `verify_phase3.sql`, `verify_phase4.sql` **only** against an owner-approved dev database. There is **no automated per-endpoint authorization inventory** (like "every handler has a gate") and no runtime cross-role test — for catch-all routes do the per-branch pass by hand, and propose that inventory test as a follow-up.
8. **Report** in the format below.

## Report format
Findings first, most severe first. For each:
- **Severity** (Critical / High / Medium / Low / Info) and **role(s) affected**
- **Where**: `path:line` (clickable) — for catch-all routes include the action name
- **What & exploit path**: one concrete scenario with a dummy principal ("patient A sends `GET /api/v2/invoice?id=<B's invoice>` → ...")
- **Evidence status**: `confirmed in code` / `confirmed on dev-staging (read-only)` / `needs validation`
- **Smallest fix** and the **test** that would pin it
- **Deploy status**: code-only / staging-verified / prod-unverified

Then: *What I checked*, *What I could not check* (live RLS/grants on a real project, Supabase Auth settings such as MFA enforcement and rate limits, Vercel env vars, Razorpay dashboard), *Owner actions*. Never claim "no issues" for anything not in the checked list. Treat [references/auth-surfaces.md](references/auth-surfaces.md) "Leads to verify" as leads, not findings: re-verify against current files before reporting.
