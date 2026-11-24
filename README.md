# Hospital Management System - Phase 4 (OPD-first)

Consolidated Phase 1 + Phase 2 + Phase 3 + Phase 4 Next.js / TypeScript monorepo. Two applications: public hospital website and secure HMS portal. Supabase PostgreSQL/Auth/Storage; Razorpay; portal-only PWA. Fictional Aarogya Care branding until configured. **Development integration baseline; not ready for real patients without staging, clinical/legal/security review and production signoff.**

## Mobile design review (no installation required)

Open `review/HMS_Mobile_Review.html` in a JavaScript-enabled browser and use the View selector. Screenshots in `review/screenshots/` show mobile/desktop renders. The HTML is an offline demo, not a working medical system or installable PWA. See `docs/PHASE4-HANDOVER.md` for details and limitations.

## Run locally

Use Node.js 22 and pnpm 10.11.0. From this folder:

```sh
npm install -g pnpm@10.11.0
pnpm install
pnpm dev
```

Website: `http://localhost:3000`. Portal: `http://localhost:3001/login`. Demo mode requires no database. Use `HMS_DEMO_MODE=true` in portal development; do not expose demo roles in production. Use the example environment files for live integration. The public website stays a normal site; only the portal registers the service worker. PWA install requires localhost or HTTPS and a supported browser.

## Database

All SQL is included under `supabase/`. Fresh project: apply migrations 001-018 in filename order. Existing Phase 3 DB: only 017-018; Phase 2 DB: only 011-018, if originals unchanged. Run `supabase/tests/verify_baseline.sql`, `verify_live.sql`, `verify_phase3.sql`, and `verify_phase4.sql`. Configure initial data with `supabase/setup/01_provision_hospital.sql`. Keep private schema grants restricted. Do not apply optional seed to real hospital. Read `supabase/README.md`.

## Structure

```
apps/website/         Public site, CMS published content, callback form
apps/portal/          Auth, staff/doctor/admin/patient UI, booking, APIs, PWA
packages/ui/          Shared visual components and styles
packages/core/        Domain boundaries (some reserved placeholders)
packages/types/       Shared contracts and demo data
packages/validation/  Shared validation
packages/config/      Shared config notes (placeholder; TS defaults in tsconfig.base.json)
packages/database/    Database access layer notes (placeholder; SQL lives in supabase/)
supabase/migrations/  18 ordered migrations (original 001-016 retained)
supabase/setup/       Initial provisioning template
supabase/tests/       SQL verification scripts
review/               Offline HTML and screenshots
scripts/              Optional QA preview harness
tests/                Security/static and Playwright tests
docs/                 Integration, architecture, API and QA notes
```

## Verification

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test:security
pnpm exec playwright install chromium
pnpm test
```

Read `docs/PHASE4-HANDOVER.md` first for what Phase 4 adds (bilingual EN/Hindi UI, patient history, booking cancellation and refunds), its limitations and the staging checklist. `docs/PHASE3-HANDOVER.md` still covers the Phase 3 baseline: environment setup, API groups and earlier implemented/deferred items. Phase 2 documents are historical. Never connect real clinical records or live payments until verification is complete.
