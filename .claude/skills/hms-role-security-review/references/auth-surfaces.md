# Auth surfaces — HMS

Derived from the repo at clone time (2026-11-25, commit `abd58ff`). Re-check paths before relying on them (`Glob` first); migrations and routes change.

## Principals

| Principal | Credential | Server helper | Backing store | Notes |
|---|---|---|---|---|
| Anonymous visitor | none | none | published projections only | May call: `GET catalog`, `GET slots`, public content RPCs, `POST /api/public/inquiry` (Turnstile), OTP request, `auth/recover` (captcha). Website never needs the service key. |
| Patient | Supabase Auth phone OTP session (httpOnly cookie, set via `@supabase/ssr`) | `currentUser(client)` in `apps/portal/lib/server/supabase.ts` (uses `auth.getUser()`) | `auth.users`, `hms.patients`, bookings | Account created by OTP with **no** workforce membership. Self-booking is adult-only, one account per organization. Needs `PHONE_VERIFICATION_REQUIRED` for booking. |
| Staff (receptionist / billing / nurse / content_manager) | email+password, then TOTP → AAL2 | `staffContext(client)` → RPC `hms_staff_context` (org, branch, roles, permissions) | `hms.memberships`, `hms.user_roles`, `hms.role_permissions` | Portal URL group `staff`. Page gate: any of those four roles. |
| Doctor | same as staff | `staffContext` + `hms_private.is_assigned_doctor`, `has_care_assignment` | `hms.doctors`, `hms.care_assignments` | Only assigned patients/appointments. Portal group `doctor`. |
| Super admin | same as staff | `staffContext`, role `super_admin` | same | Branch operations; "no implicit clinical rights". Portal group `admin`. Holds `users.manage`, `roles.manage`, `refunds.approve`, `settings.manage`, `cms.publish`, `audit.read`. |
| Cron / maintenance | `Authorization: Bearer $CRON_SECRET` | inline in `app/api/internal/maintenance/route.ts` | env | Requires secret ≥32 chars, `timingSafeEqual`, and `HMS_DEMO_MODE==='false'`. Fails closed (401). |
| Razorpay webhook | `x-razorpay-signature` HMAC over raw body | `signatureValid`, `settle` (`lib/server/razorpay.ts`, `payment-crypto.ts`) | `hms_capture_payment` (service_role only) | Only route exempt from `sameOrigin`. Event id + payload digest persisted for idempotency. |
| Document scanner callback | `HMS_PRIVATE_SCANNER_TOKEN` bearer (outbound from portal) | v2 `documents/upload`, v3 paper upload | storage `hms-private-documents` | Uses `serviceClient()` for the stored object and `hms_v3_document_add` / `hms_v4_paper_add`. |

## Roles and permissions (migration `202611240004_rbac_rls.sql`)
`doctor`, `receptionist`, `billing`, `nurse`, `content_manager`, `super_admin`. Permission keys: `appointments.read`, `appointments.assigned.read`, `appointments.create`, `appointments.checkin`, `patients.demographics.read`, `patients.assigned.read`, `patients.register`, `clinical.assigned.read|write`, `prescriptions.issue`, `billing.read`, `payments.collect`, `refunds.approve`, `users.manage`, `roles.manage`, `cms.manage`, `cms.publish`, `audit.read`, `settings.manage`. Later migrations may add or change grants — read them all (`ls supabase/migrations`).

## Layers
1. **Edge** — `apps/portal/proxy.ts`: session refresh + `Cache-Control: private, no-store` on `/doctor|staff|admin/*`, `/login`, `/book`, `/my-bookings`, `/manage-booking`, `/patient`, password pages. It is a no-op in demo mode. **Not an authorization layer and does not match `/api/**`.**
2. **Page (server component)** — `app/[role]/[[...section]]/page.tsx`: `notFound()` for unknown role/section; in live mode `staffContext` + role check else `redirect('/login')`.
3. **Route handler** — `app/api/v1|v2|v3/[...action]/route.ts`: catch-all dispatch by string compare. Pattern: demo guard → `sameOrigin` (POST) → zod parse → `sessionClient()` → `currentUser` → `staffContext` → RPC. A new `if (action === ...)` placed *above* the `currentUser`/`staffContext` lines is unauthenticated. Order matters: review the position of every branch.
4. **SQL** — `public.hms_*` RPCs (SECURITY DEFINER, call `hms_private.*` helpers) are the final boundary. Browser roles have no table grants; RLS enabled on every `hms.*` table; draft SELECT policies exist for appointments, patients, encounters, invoices, audit_logs.
5. **Storage** — private bucket `hms-private-documents`; downloads via 60-second signed URL minted with the service role **after** `hms_v3_document_access`.

## Env switches that change the security posture
`HMS_DEMO_MODE` (true → all roles open, live API 503); `NODE_ENV=development` also enables demo unless `HMS_DEMO_MODE=false`; `HMS_RAZORPAY_MODE`, `HMS_ENABLE_REAL_PAYMENTS`; `NEXT_PUBLIC_PORTAL_URL` (CSRF origin; wrong value blocks or over-allows POSTs); `HMS_ALLOW_INDEXING`; `HMS_PUBLIC_LIVE`.

## Leads to verify (not findings — re-check against current files)
1. v1 GET: `catalog`, `slots`, `bookings`, `auth/session` run before `staffContext`; confirm nothing else slipped above that line and that `hms_catalog`/`hms_available_slots` return only published data.
2. v2/v3 GET handlers call `currentUser` before patient-scoped RPCs, but confirm each RPC itself scopes to `auth.uid()` (e.g. `hms_v3_invoice`, `hms_v3_documents`, `hms_v3_move_slots`) — the route does not pass a user id.
3. `staff/clinical` GET/POST pass only a record id: confirm `hms_clinical_draft` checks assignment + `clinical.assigned.*` + AAL2 and audits reads.
4. `hms_v3_roles` (role assignment) and `hms_v3_link_invite` (service-role invite): confirm only `roles.manage`/`users.manage`, cannot grant `super_admin` to self, cannot cross organizations.
5. Refunds: `staff/refunds/create` requires `refunds.approve`; `hms_apply_refund` is service_role only; provider response matched to payment+amount; `policy-refunds.ts` cron path cannot be triggered by users.
6. Which `public.hms_*` functions are granted to `anon`/`authenticated` — grep every `GRANT EXECUTE` and compare to the intended list in `docs/API.md`.
7. `app/auth/callback` and `auth/confirm`: open-redirect via `next` param (`/auth/callback?next=...`); confirm only same-site relative paths are accepted.
8. `api/public/inquiry`: CORS allowlist (`OPTIONS`), Turnstile verification fails closed when secret missing, no PHI stored beyond the form, abuse limits.
9. Demo-mode leakage: `demoEnabled` is derived from `NODE_ENV`; confirm production builds set `HMS_DEMO_MODE=false` explicitly (deployment doc) and that a missing Supabase env does not silently fall into a permissive path (`proxy.ts` returns `next()` when Supabase env is absent).
10. Seed data (`supabase/seed.sql`) is synthetic and must not be applied to a real hospital database.

## Where to look for existing evidence
`docs/API.md` (endpoint map), `docs/LIVE-INTEGRATION.md` (env, auth model, payments), `docs/PHASE3-HANDOVER.md`, `docs/CURRENT-HANDOVER.md`, `supabase/README.md`, `supabase/tests/verify_*.sql`, `tests/security-static.test.cjs`, `docs/QA-PHASE2.md`.
