# Environment variables

Every variable the code reads (checked by searching the source). Templates: `apps/portal/.env.local.example` and `apps/website/.env.local.example`. Missing configuration fails closed: the affected feature returns "Service is not configured" (`CONFIGURATION_REQUIRED`) instead of falling back to demo behaviour. `GET /api/health` with `Authorization: Bearer $CRON_SECRET` reports which groups are configured, without values (`apps/portal/lib/server/config-check.ts`).

**Never** put a secret in a `NEXT_PUBLIC_*` variable: those are compiled into browser JavaScript.

## Portal (`apps/portal`)

| Variable | Secret | Required for | Notes |
|---|:-:|---|---|
| `HMS_DEMO_MODE` | | Mode | `true` = offline demo with sample data. Must be `false` for live, staging and maintenance. In local development, demo is the default unless set to `false`. |
| `NEXT_PUBLIC_PORTAL_URL` | | Core | Portal origin, no trailing slash. Used for Origin (CSRF) checks and auth redirects. |
| `NEXT_PUBLIC_WEBSITE_URL` | | Core | Website origin; callback form CORS. |
| `NEXT_PUBLIC_HOSPITAL_NAME` | | Branding | Display name. |
| `NEXT_PUBLIC_SUPABASE_URL` | | Core | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | | Core | Publishable (anon) key. Safe in the browser because of DB grants and RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | Core | Server only. Used for payment, refund, document and worker paths. |
| `HMS_ORGANIZATION_SLUG` | | Core | Must match `hms.organizations.slug`. |
| `HMS_BRANCH_CODE` | | Core | Must match `hms.branches.code` (default `MAIN`). |
| `HMS_NOTICE_VERSION` | | Booking | Version of the approved privacy/booking notice; recorded with each consent. |
| `HMS_NOTICE_URL` | | Booking | Public URL of that notice. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | | Auth | Turnstile site key. The matching secret is configured in Supabase Auth, not here. |
| `HMS_RAZORPAY_MODE` | | Payments | `test` (default) or `live`. |
| `HMS_ENABLE_REAL_PAYMENTS` | | Payments | Must be `true` **and** the mode `live` **and** the key `rzp_live_…` before real money moves. |
| `RAZORPAY_KEY_ID` | | Payments | Sent to the browser for checkout. |
| `RAZORPAY_KEY_SECRET` | ✓ | Payments | Server only. |
| `RAZORPAY_WEBHOOK_SECRET` | ✓ | Payments | Webhook signature secret. |
| `CRON_SECRET` | ✓ | Worker, health detail | ≥ 32 random characters. Sent as `Authorization: Bearer …` by the scheduler. |
| `HMS_RECONCILIATION_ENABLED` | | Worker | `true` to reconcile orders and refunds with Razorpay. |
| `HMS_AUTO_POLICY_REFUNDS` | | Refunds | `true` to start policy refunds automatically. Default: admin approves each refund. |
| `HMS_NOTIFY_EMAIL`, `RESEND_API_KEY`ᵃ, `HMS_FROM_EMAIL` | ᵃ | Email | Opt-in patients only. |
| `HMS_NOTIFY_SMS`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`ᵃ, `TWILIO_FROM` | ᵃ | SMS | DLT-registered templates required in India. |
| `HMS_NOTIFY_WHATSAPP`, `WHATSAPP_ACCESS_TOKEN`ᵃ, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_VERSION`, `HMS_WA_LANGUAGE`, `HMS_WA_TEMPLATE_MAP` | ᵃ | WhatsApp Business API | `HMS_WA_TEMPLATE_MAP` is JSON mapping event keys to approved template names. |
| `HMS_PRIVATE_SCANNER_URL`, `HMS_PRIVATE_SCANNER_TOKEN`ᵃ | ᵃ | Uploads | HTTPS malware scanner returning `{"clean":true}`. Without it, uploads are refused. |
| `HMS_CALLBACK_ENABLED`, `HMS_CALLBACK_TURNSTILE_SECRET`ᵃ | ᵃ | Website callback form | Handled by the portal server. |

ᵃ secret

## Website (`apps/website`)

| Variable | Notes |
|---|---|
| `HMS_PUBLIC_LIVE` | `true` loads only published CMS content from Supabase; `false` shows the preview content. |
| `HMS_ALLOW_INDEXING` | `true` only for the real production domain. |
| `NEXT_PUBLIC_WEBSITE_URL`, `NEXT_PUBLIC_PORTAL_URL` | Origins. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public content RPCs only. |
| `HMS_ORGANIZATION_SLUG`, `HMS_BRANCH_CODE` | Same values as the portal. |
| `NEXT_PUBLIC_HOSPITAL_NAME`, `_DESCRIPTION`, `_ADDRESS`, `_PHONE`, `_EMAIL`, `_HOURS` | Contact details shown on the site. Use real, verified details; never placeholders. |
| `NEXT_PUBLIC_HOSPITAL_WHATSAPP` | E.164 digits without `+`. This is a chat link, not the WhatsApp Business API. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Callback form CAPTCHA. |

The website needs **no** secrets. Do not add the service-role key to the website project.

## CI

CI uses only `HMS_DEMO_MODE=true` and the two origins, plus `GITHUB_TOKEN` for Gitleaks. The database job uses a throwaway Postgres container with password `postgres`.
