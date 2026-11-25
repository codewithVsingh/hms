# Live integration checklist (staging first)

## 1. Scope and deployments

Keep the two Next.js applications in a single workspace. Vercel website root `apps/website`; Vercel portal root `apps/portal`. Enable source files outside each root if required. Use the workspace pnpm install and the Next.js preset. The portal hosts `/api/v1` and keeps payment/auth secrets server-side. Website fetches only anonymous catalog and published CMS RPCs; it never needs a service role key. Railway is optional for future workers. Align compute and database regions where possible.

Start by using Node 22 and `pnpm install`, `pnpm typecheck`, `pnpm build`, `pnpm test:security`, and `pnpm test`. Create separate `.env.local` files from each app's example. Run development and staging with synthetic data. Keep demo isolated; live applications must not expose fake roles or data.

## 2. Environment and identity

Portal `.env.local`: set `HMS_DEMO_MODE=false`, actual portal and website origins (no trailing slash), hospital brand, Supabase URL/publishable key and **server-only** service role key, organization slug and branch code matching SQL, approved `HMS_NOTICE_VERSION` and `HMS_NOTICE_URL`, Turnstile public site key. Set `HMS_RAZORPAY_MODE=test` and `HMS_ENABLE_REAL_PAYMENTS=false`, use test Razorpay keys. Keep all server secrets out of `NEXT_PUBLIC_*`, logs, Git and website project. Configure the Auth password policy, SMS provider, CAPTCHA and rate limits inside Supabase. Supabase phone OTP creates a patient Auth account without a workforce membership. Staff use separately invited/created email/password accounts plus TOTP; role/branch authorization requires AAL2 and active membership at DB level. No staff self-registration or password reset UI. Admin should provision/recover staff accounts through Supabase's supported process, not share credentials.

The booking API uses same-origin POST checks. Configure `NEXT_PUBLIC_PORTAL_URL` to the exact origin being used; use distinct environment variables in preview/staging/production. Set `HMS_PUBLIC_LIVE=true` on the website only once actual data and public configuration are ready. Keep `HMS_ALLOW_INDEXING=false` until branding, medical content, privacy notices, policies and healthcare advertising compliance have been reviewed. Enter `NEXT_PUBLIC_HOSPITAL_WHATSAPP` as digits with country code, e.g. use your actual verified Indian number prefixed by 91. There is no invented number; if empty the icon links to `/contact`. The WhatsApp link contains only a generic appointment inquiry, never patient identifiers or payment data. Configure actual hospital address, phone, email, hours, description.

## 3. SQL and initial configuration

Follow `supabase/README.md`. Apply migrations 001–010 (only 006–010 if migrations 001–005 were already applied unchanged), run verification scripts, then provision workforce and organization with `supabase/setup/01_provision_hospital.sql`. Configure doctors/weekly schedules in admin settings and generate the next 31 days. Add additional staff and doctors via the same SQL pattern. Keep online booking/payment disabled until ready. The admin UI manages existing doctor fee/publication and schedules, not Auth invitations. For schedule changes requiring inventory replacement, review old future slots and existing appointments with the database operator. Time zone is Asia/Kolkata in the UI; keep the initial branch configured accordingly.

## 4. Razorpay test integration

Use a Razorpay test key ID and secret, and a separate webhook secret. Configure payment capture to automatic in Razorpay as appropriate. Set webhook URL:

`https://YOUR-PORTAL-DOMAIN/api/v1/payments/webhook`

Subscribe to `payment.captured` and `order.paid`. The server checks the raw webhook signature and fetches the actual payment from Razorpay, validates the order/amount/currency and captured state, then commits transactionally. It returns a retryable response on failed processing; duplicate events are safe at payment-ID level. `payment.failed` is not used to confirm or release a paid booking; holds expire independently. No browser-supplied amount is accepted as the payable fee. Razorpay callback verification and My Bookings recovery also verify actual captured payments. Never use real money in test mode.

For refunds, cancel the appropriate future appointment first, then an authorized administrator explicitly approves a full refund for the eligible captured or reconciliation-required payment. The gateway response is matched to the payment and amount; use the finance screen to check pending/uncertain refunds against Razorpay. Refund notifications/webhooks and automatic polling are not yet built. Partial/offline refunds require a separate manual accounting process. If a request times out, do NOT repeatedly initiate a new refund/order. Inspect provider dashboard using the stored receipt/IDs and reconcile. An order creation failure after the DB claim remains blocked for manual review; a production operator recovery UI for unattached orders is not implemented. For a new deployment, check provider account event coverage and alert on repeated webhook failures.

Real payments require `HMS_RAZORPAY_MODE=live`, a `rzp_live_` key, `HMS_ENABLE_REAL_PAYMENTS=true`, approved policy and explicit signoff, after the complete acceptance matrix passes. The hospital booking/payment toggles control new bookings. Keep test/live credentials, databases and webhooks separate. Do not disable gateway verification while outstanding live payments/refunds need reconciliation.

## 5. CMS and launch

Create plain-text content in CMS (page, service, article, FAQ or campaign). A doctor reviews and approves; admin publishes. Use page slugs `about`, `privacy`, `booking`, `refund` for built-in navigation. `/pages/<slug>`, `/services/<slug>`, `/health-library/<slug>`, `/faq/<slug>` and `/campaigns/<slug>` serve published entries. Published doctor details are loaded from the actual DB. Confirm all content, contact data, clinician credentials and prices. Keep ad pixels and session replay off clinical, login, booking and payment pages. No marketing scripts are included. Complete healthcare privacy/security, advertising review, access tests, backups (database plus private files), incident response and disaster recovery drills before launch. No production certification is implied.

## 6. Operational limitations

Patient direct rescheduling is not implemented (use unpaid cancellation and rebook; paid cancellation requires administrator refund review). Self-booking is adult-only with one account/organization; guardians/dependent patients use reception. Signed prescriptions/records, medical document uploads, automated appointment reminders, patient merge, invite/role admin UI and rich report exports remain future work. Draft clinical notes are versioned and become read-only when the visit is completed; they are not legally signed records. Audit captures implemented mutations and clinical draft reads, not exhaustive patient access/export logging. Staff queries have bounded row limits rather than full pagination. No real data until independent clinical/privacy review and staging acceptance.
