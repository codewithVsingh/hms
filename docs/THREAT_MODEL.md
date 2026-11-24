# Threat model

## Assets

Patient identity and contact details · clinical records and prescriptions · medical documents · payment and refund records · staff accounts (especially admins) · audit trail · hospital configuration (fees, policy, schedules) · service credentials (Supabase service role, Razorpay, providers).

## Actors

| Actor | Trust | Access path |
|---|---|---|
| Website visitor | Untrusted | Website, public RPCs (catalog, slots, content, policy), callback form |
| Patient | Authenticated by phone OTP | Portal booking, own bookings and records |
| Staff (reception, billing, nurse, content) | Authenticated, MFA, branch-scoped roles | Portal workspace |
| Doctor | Authenticated, MFA, assigned patients only | Clinical workspace |
| Admin | Authenticated, MFA, full branch control | Settings, roles, refunds |
| Payment provider | Signed webhooks | `/api/v1/payments/webhook` |
| Operator / scheduler | `CRON_SECRET` | `/api/internal/maintenance`, `/api/health` (detail) |
| Attacker | — | Any public surface, stolen credentials, malicious uploads, supply chain |

## Trust boundaries

1. Browser → portal API (Origin check, session cookie, validation)
2. Portal server → Supabase (user-scoped client for user actions; service role only for payment, refund, document and worker paths)
3. Supabase API → database (no schema access for browser roles; RPC permission checks; RLS)
4. Payment provider → webhook (HMAC over raw body)
5. Portal → external providers (fixed hosts, timeouts)

## Threats and mitigations (STRIDE)

| Threat | Example | Mitigation | Residual |
|---|---|---|---|
| Spoofing | Use someone's booking reference to cancel | Verified phone session and ownership required (T5) | SIM swap: accept; staff can verify |
| Spoofing | Forged payment webhook | HMAC on raw body with constant-time compare; payment re-fetched from Razorpay | — |
| Spoofing | Staff account takeover | MFA (aal2) enforced in DB; CAPTCHA; Auth rate limits | Phishing: training, short sessions |
| Tampering | Change fee or refund amount in the browser | Server calculates; client values must match exactly (T3, T6) | — |
| Tampering | Overwrite an issued prescription | `SIGNED_RECORD` guard | No amendment workflow yet (HMS-017) |
| Tampering | Erase audit history | Append-only triggers (T11) | DB owner can disable triggers: restrict owner credentials |
| Repudiation | "I didn't cancel / refund that" | Audit log with actor, action, resource and time (T9) | No request correlation ID yet |
| Information disclosure | Read other patients' data via the Supabase REST API | No grants, no schema usage, RLS (T1, T8) | — |
| Information disclosure | Doctor reads unassigned patient | Care-assignment checks in clinical RPCs | Cross-branch history not implemented by design |
| Information disclosure | Cached patient data on a shared device | PWA caches nothing; `no-store` on APIs | Browser history on shared devices: logout guidance |
| Information disclosure | Clinical details in SMS/WhatsApp | Fixed templates with no clinical content | — |
| Denial of service | Slot hoarding with held bookings | 10-minute holds, booking limits per account | Many accounts: CAPTCHA + rate limits (HMS-020) |
| Denial of service | Webhook flood | Signature check first, payload size cap | Edge rate limit recommended |
| Elevation of privilege | Grant self admin | Self-assignment blocked; only `roles.manage` (admin) can assign; invites can't grant admin | Rogue admin: two-admin policy and audit review |
| Elevation of privilege | Call payment/refund service RPCs | Granted to `service_role` only (T4) | Service key leak: rotate; key only on portal server |
| Malicious upload | Malware in "report.pdf" | Magic bytes, mandatory scanner, private bucket, signed URLs | Scanner quality is the operator's choice |
| Supply chain | Compromised dependency | Lockfile, audit, Dependabot, CodeQL | — |
