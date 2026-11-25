# HMS live integration — integration-ready source

This is the integration-ready version of the original UI-preview monorepo. It contains the retained fictional UI preview and a separate live application implementation using Supabase Auth/PostgreSQL, server-authorized RPCs and Razorpay. **Not production-certified.** No live project, OTP provider, payment account, production hospital information or credentials were connected during authoring. Do not use real patients or real money until staging acceptance and healthcare security/privacy review are complete.

## Open the existing UI without credentials

Node.js 22 LTS and pnpm 10 are required. From the repository root:

```sh
npm install -g pnpm@10.11.0
pnpm install
pnpm dev
```

Website: http://localhost:3000. Booking: http://localhost:3001/book. Staff login: http://localhost:3001/login. Existing role preview pages remain available in demo mode. No patient data or money is collected in demo mode.

Copy the two `.env.local.example` files to `.env.local` inside the respective app folders when ready. Read **docs/LIVE-INTEGRATION.md** for integration order, environment variables and payment safety. Read **supabase/README.md** before applying SQL. Live features require actual configuration and should first run against a separate test project and Razorpay test account.

## Implemented source (live mode)

- Public website: configurable real hospital brand/contact, verified published doctors, server-rendered published CMS entries, public sitemap and controlled indexing, responsive animations, click-to-call, directions, WhatsApp click-to-chat. No tracking pixels or fictional content in live public mode.
- Patient booking: phone OTP via Supabase with Turnstile, adult self-booking, real slot inventory, current fee validation, transactional locks and unique slot protection, idempotent request, pay-at-hospital and Razorpay, patient-owned booking history, unpaid cancellation, payment recovery and printable booking confirmation.
- Payments: backend order creation, one gateway order per invoice, checkout and webhook HMAC, provider-side captured/amount/currency/order verification, duplicate/late capture handling, offline collections, administrator-approved full refunds, manual gateway reconciliation. Real payment keys are explicitly gated. No card information is handled by the application.
- Workforce: email/password, mandatory TOTP MFA, active branch membership, permission and resource-scoped RPCs, protected routes, role-aware navigation. Reception registers patients, books on the shared slot inventory, checks in and cancels; doctors start/complete assigned visits and version draft notes; billing records received payments; administrators manage doctor publication/fee, schedules, slot generation, booking toggles, content workflow, refund review and audit list.
- CMS: create/edit plain-text drafts, clinician review, approval, publication/archival. Public website reads published rows only. SEO metadata and canonical public links available; review all marketing content before indexing.
- DB: ten ordered migrations, locked transactional booking/payment/refund functions, restricted public catalog RPCs, authenticated AAL2 staff functions, server-only settlement functions, private schemas and RLS, setup script and verification checks.

## Repository

- `apps/website`: marketing website with public-only server RPC adapter and no clinical keys.
- `apps/portal`: live/demo pages, responsive workspaces, `features/live`, auth/session and gateway logic under `lib/server`, API routes under `app/api/v1/[...action]`.
- `packages/ui`, `packages/types`, `packages/validation`: shared components/types/preview validation. `packages/core` retains domain extraction boundaries; current transactional domain operations live in SQL and the portal's server integration. Do not assume every reserved domain module is complete.
- `supabase/migrations`: apply in numerical order; `supabase/setup`: initial workforce/hospital provisioning; `supabase/tests`: DB privilege checks.
- `tests`: existing demo Playwright tests, additional WhatsApp assertion and executable security/static tests.
- `docs`: architecture, live integration, API map, QA and remaining work.

## Verify locally

```sh
pnpm test:security
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm test
```

The full dependency installation and Next.js build could not run here because npm registry DNS was unavailable. No PostgreSQL instance or provider credentials were available. Source syntax, payment cryptography/guard tests and a limited demo browser component harness were checked. See `docs/QA-ACCEPTANCE-MATRIX.md` for exactly what passed and what must be tested next. Generate and commit the pnpm lockfile after successful install. Audit dependencies before deployment.

## Still out of scope / incomplete

Live end-to-end provider/database validation; automatic WhatsApp/SMS/email appointment reminders (only OTP via configured Supabase SMS and a WhatsApp contact shortcut are integrated); direct rescheduling (cancel and rebook); guardian/dependent self-service; signed prescriptions, PDF prescriptions and invoices, medical-document upload/scanning, finalized clinical records/vitals; invite/reset/role-management UI and patient identity merge; payment-order uncertainty operator tool, refund webhook/automatic polling, partial/offline refund ledger; richer financial analytics/export; IPD/lab/pharmacy; production marketing campaigns, consented tracking, legal notices and backup/recovery drills. User provisioning is supplied as SQL rather than a privileged in-app user invitation system.
