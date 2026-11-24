# Security hardening

What the codebase enforces, and the operator checklist for settings that live outside the repository.

## Enforced in code (verified)

- **Database:** browser roles have no access to the `hms`/`hms_private` schemas. All access goes through narrow RPCs that check permission or ownership. SECURITY DEFINER functions pin `search_path=''`. Staff functions require `aal2` (MFA). The audit log is append-only (migration 019).
- **Booking:**
  - Fee taken from the server.
  - Policy version acknowledged.
  - Idempotent request IDs.
  - Unique index of one live appointment per slot.
  - Row locks.
  - 10-minute hold.
  - Limit of 3 active future bookings and 8 per hour per account.
- **Payments:** order amount from the server; HMAC signature over the raw body with constant-time compare; payment re-fetched from Razorpay and amount/currency checked; webhook event IDs de-duplicated; test keys unless `HMS_RAZORPAY_MODE=live` and `HMS_ENABLE_REAL_PAYMENTS=true` with an `rzp_live_` key.
- **Refunds:** amount calculated on the server; a refund is claimed once; the provider result must match the stored amount and receipt; unknown outcomes are held for review and never blindly retried.
- **API:** Origin check on every state-changing route; zod validation; body size limits; non-object JSON rejected; fixed error messages; `Cache-Control: private, no-store`.
- **Uploads:** 4 MB limit; PDF/PNG/JPEG magic bytes; an approved HTTPS scanner must return `{"clean":true}` or the upload is refused; private bucket; random paths; 60-second signed URLs.
- **Headers:** HSTS (production), `nosniff`, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'; base-uri 'self'; object-src 'none'`, Referrer-Policy, Permissions-Policy; the portal sends `X-Robots-Tag: noindex`.
- **PWA:** portal only; no response caching; all caches cleared on update; generic offline page.
- **CI:** read-only token, Gitleaks over full history, `pnpm audit`, CodeQL (security-extended), Dependabot, frozen lockfile, database security tests.

## Operator checklist (before staging)

**Supabase Auth**
- [ ] Minimum password length ≥ 12 for staff, with leaked-password protection on
- [ ] TOTP MFA enabled; every staff account enrolled (the portal refuses staff actions without MFA)
- [ ] Phone (SMS) provider configured; OTP expiry ≤ 5 minutes; Auth rate limits reviewed
- [ ] Turnstile CAPTCHA enabled for sign-in, OTP and password recovery
- [ ] Email signups disabled (staff are invited); redirect URLs restricted to the portal origin
- [ ] JWT expiry ≤ 1 hour; refresh-token rotation and reuse detection on; staff session time-box (e.g. 12 h)

**Supabase database and storage**
- [ ] Exposed schemas = `public` only (never add `hms` or `hms_private`)
- [ ] `hms-private-documents` bucket is private, and no broad `storage.objects` policies exist
- [ ] Network restrictions / SSL enforcement on; point-in-time recovery enabled
- [ ] Run `supabase/tests/verify_*.sql` after migrating; all pass

**Hosting**
- [ ] `SUPABASE_SERVICE_ROLE_KEY`, Razorpay secrets, `CRON_SECRET` and provider tokens set only on the portal server project (never `NEXT_PUBLIC_*`, never on the website project)
- [ ] HTTPS only; custom domains; preview deployments use a separate Supabase project with no real data
- [ ] Edge rate limiting (WAF) on `/api/*` (see HMS-020)
- [ ] `GET /api/health` with the operator secret shows `mode: "live"` and expected checks
- [ ] Error monitoring configured with PII scrubbing (no request bodies)

**GitHub**
- [ ] Secret scanning and push protection on (Settings → Code security)
- [ ] Branch protection on `main`: PR required, all checks required, no force-push
