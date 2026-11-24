# Project audit

## Original condition (imported 24 Nov 2026, commit `6d61733`)

- Next.js 16 / React 19 / TypeScript monorepo (pnpm + Turborepo) with two apps:
  - `apps/website`: public site.
  - `apps/portal`: patient and staff portal, API route handlers and a portal-only PWA.
- Shared packages: `ui` (components and EN/HI localisation), `types`, `validation`. The `config` and `database` packages are placeholder READMEs.
- Supabase Postgres (18 migrations), Supabase Auth (phone OTP for patients, email + TOTP for staff), Supabase Storage (private bucket), Razorpay, optional Resend/Twilio/WhatsApp, Cloudflare Turnstile.
- Demo mode (`HMS_DEMO_MODE=true`) runs both apps with sample data and no backend.
- Earlier documentation stated plainly that the build, the type check and the SQL had **not** been executed. This audit is the first time they were.

### Baseline results

| Check | Result |
|---|---|
| Install, typecheck, build | Pass once dependencies were installed |
| Static security tests | 9/9 |
| E2E | 15/18: test bug (fixed on `main`) |
| CI on GitHub | Failing on every push |
| Lockfile | Missing |
| SQL on PostgreSQL | **Fresh install failed at migration 012** |
| `verify_live.sql` | Failed (contradicted migration 018) |

## Architecture findings

- **Good:** a database-centred security model. Browser roles can't touch tables; every operation is a permission-checked RPC with a pinned `search_path`; staff need MFA at the database level; money is in integer paise; there are careful lock orders and idempotency keys. This is a sound design for health data, and the tests confirmed it holds.
- **Good:** payments and refunds are designed for failure: claim/attach order protocol, re-fetching from Razorpay before trusting anything, reconciliation for late captures, and never blindly retrying a refund.
- **Good:** privacy-first PWA (no caching) and fixed, content-free notification templates.
- **Weak:** nothing had ever been executed. The SQL had a syntax error, the verify scripts contradicted each other and CI never passed. Addressed in this branch.
- **Weak:** minified one-line source made review hard. Formatted on `main` (Prettier/ESLint).
- **Gaps:** clinical amendments, duplicate patients, doctor-unavailability workflow, app-level rate limiting, Hindi coverage, operational runbooks. See [GAP_ANALYSIS.md](GAP_ANALYSIS.md).
- **Single branch:** the schema is multi-organization and multi-branch, but the apps are configured for one branch (`HMS_BRANCH_CODE`). That's fine for OPD-first, but multi-branch UI would be new work.

## Work done (see [IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md))

On `main` (earlier in the same engagement): CI fix, maintenance-job isolation, JSON validation, lockfile, Prettier/ESLint.
On this branch: migration 012 fix, verify script fix, database test suite in CI, migration 019 (random references, append-only audit), health check, error boundaries, HSTS, service-worker purge, CI security scanning, and this documentation set.
