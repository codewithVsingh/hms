# Security audit

Scope: the website, portal API routes, server libraries, Supabase migrations 001–019, storage, the PWA, CI and git history. Method: code review plus execution. Migrations were applied to PostgreSQL 16 with a Supabase role shim that mirrors Supabase's default grants. Privileges were then queried from the catalogue, and behaviour was tested by impersonating each role (`supabase/tests/local`).

This is an engineering review, not a certification. A penetration test against a staging deployment with real Supabase Auth, Razorpay test mode and the actual hosting configuration is still required. See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

## Summary

| Area | Result |
|---|---|
| Broken access control / IDOR | No issues found. Ownership and permission checks are enforced in the database and proven by tests T5 and T8. |
| Privilege escalation | No path found. Roles can't be self-assigned; invites can't grant admin (T2, T8). |
| Direct Supabase API access | Blocked: no schema usage or table grants for browser roles; RLS on all tables (T1, T8 and catalogue queries). |
| Payment integrity | Strong. Server amounts, replay-safe capture, mismatch rejection (T4). |
| Refund integrity | Strong. Server-side quote, single claim, provider match, no partial→full escalation (T6, T7). |
| Concurrency | One booking per slot under 20 parallel attempts (T10). |
| Audit trail | Now append-only (T11). Patient search not yet audited (HMS-019). |
| Booking references | Now random and non-sequential (T11). |
| XSS | One `dangerouslySetInnerHTML`: JSON-LD with `<` escaped. Safe. |
| CSRF | All state-changing routes check `Origin` against the portal origin; cookies are `SameSite=Lax` and `HttpOnly`. |
| SSRF | Outbound calls go only to fixed provider hosts. The scanner URL is operator-configured and must be HTTPS. No user-supplied URLs are fetched. |
| Open redirect | None. Auth callbacks redirect to fixed paths on the configured portal origin. |
| File upload | Size limit, magic bytes, mandatory scanner, private bucket, random paths, 60-second signed URLs after an access check. |
| Error leakage | Error codes are mapped to fixed messages; unknown errors return a generic message. Error pages show only a digest. |
| Secrets | None in history (pattern scan of all commits). Gitleaks is now in CI. |
| Dependencies | `pnpm audit --prod`: no known vulnerabilities. Audit, Dependabot and CodeQL are now in CI. |
| Headers | `nosniff`, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy; HSTS added. Portal: `noindex`, no-store on APIs. |
| PWA caching | No caching of any response; generic offline page; all origin caches cleared on update. |

## Findings and status

| ID | Severity | Finding | Status |
|---|---|---|---|
| SEC-01 (HMS-004) | Low | Sequential booking references aided enumeration and disclosed volume | Fixed (migration 019) |
| SEC-02 (HMS-005) | Medium | Audit log could be modified or deleted by owner-level code | Fixed (migration 019) |
| SEC-03 (HMS-010) | Medium | CI had no permission restriction, secret scanning, dependency or code scanning | Fixed |
| SEC-04 (HMS-013) | Low | No HSTS | Fixed |
| SEC-05 (HMS-019) | Low | Patient search not audited | Open |
| SEC-06 (HMS-020) | Medium | No app-level rate limiting on authenticated endpoints | Open: add an edge/WAF rate limit before launch |
| SEC-07 | Low | CSP covers framing, base-uri and objects only; no `script-src`. Next.js inline scripts need nonces for a strict CSP. | Open: add a nonce-based CSP via middleware once integrations are known |
| SEC-08 (HMS-029) | Low | Actions pinned by tag, not SHA | Open |
| SEC-09 | Info | Demo mode is on only when `HMS_DEMO_MODE=true` (or in local development). It never activates silently in production, but a misconfigured deployment could show demo screens. | Mitigated: `/api/health` reports `mode`; check it in deploy verification |
| SEC-10 | Info | Webhook handles `payment.captured` and `order.paid` only. Refund outcomes come from the reconciliation job (polling). | Accepted |

## Configuration that software cannot enforce

These Supabase and hosting settings must be set by the operator (checklist in [SECURITY_HARDENING.md](SECURITY_HARDENING.md)):

- Auth password policy and leaked-password protection.
- MFA (TOTP) enabled.
- OTP expiry and length.
- Auth rate limits.
- CAPTCHA (Turnstile) on sign-in, OTP and recovery.
- Signups restricted to phone OTP for patients.
- JWT expiry and refresh-token rotation.
- Session time-box for staff.
- `hms` and `hms_private` not added to exposed schemas.
- Service-role key only on the portal server.
- Storage bucket private.
- Database network restrictions.
- Point-in-time recovery.
