# Release lanes, environments and service boundaries

How we ship the website, the portal and the database from one repository with two environments (**staging** for testing, **production** for real users), at minimum hosting cost. Read this before changing anything that crosses a boundary.

## 1. What is deployed where

| Unit        | Code                                 | Staging                          | Production                          |
| ----------- | ------------------------------------ | -------------------------------- | ----------------------------------- |
| Website     | `apps/website`                       | Vercel project `hms-website-stg` | Vercel project `hms-website-prod`   |
| Portal      | `apps/portal`                        | Vercel project `hms-portal-stg`  | Vercel project `hms-portal-prod`    |
| Database    | `supabase/`                          | Supabase project (staging)       | Supabase project (production)       |
| Shared code | `packages/ui`, `types`, `validation` | built into both apps             | built into both apps                |

That is **4 Vercel projects and 2 Supabase projects**. Each Vercel project has Root Directory `apps/website` or `apps/portal`, is connected to this same GitHub repo, and differs only in tracked branch, environment variables and domain.

- **Website**: public pages, published content, callback form. No clinical data, no secrets.
- **Portal**: sign-in, patient booking/cancellation, staff/doctor/admin workspaces, `/api/v1..v3`, payments, maintenance route, PWA (login + staff workspaces only).
- **Database**: schema, RLS, RPCs (the final authorization boundary), auth, private storage.

Everything else (accounts, booking, payments, clinical, notifications, reports, CMS) is a **module inside the portal and database**, not a separate deployment (section 8). Accounts is Supabase Auth: managed, nothing for us to deploy.

## 2. Branches: stages, not services

```
feature/* --PR (ci-ok)--> staging --[manual, approved, fast-forward]--> main
                            |                                             |
                   staging Vercel projects                    production Vercel projects
                   staging Supabase                           production Supabase
```

- Only two long-lived branches: **`staging`** (what is being tested) and **`main`** (what real users run). No branch per service, no branch per feature area.
- Services are folders in the same repo. A change to one service only builds and deploys that service because each Vercel project skips builds when its app (and the packages it depends on) did not change (section 3).
- `staging` is where all testing happens: every service, together, against the staging database.
- **Promotion = fast-forward `main` to the exact commit tested on `staging`.** No merge commit, no new commit id. If staging has changes in three services and everything is tested, all three go to production together; services with no change since the last release are not rebuilt.

Branch protection (GitHub rulesets, manual): on `staging` and `main` require a pull request and the `ci-ok` check, no force-push, no deletion. `main` additionally allows direct pushes **only** from the promotion workflow (bypass for the token in `PROMOTE_TOKEN`).

### Promoting staging to production

1. Everything you want to ship is merged to `staging`, deployed, tested and signed off on the staging URLs. Run the **Post-deploy smoke** workflow against staging.
2. If the range contains database migrations: back up production, apply them to the **production Supabase** in order, run `supabase/tests/verify_*.sql`.
3. Actions > **Promote staging to production** > Run workflow (`sha` empty = current head of staging; tick `migrations_applied` if step 2 applied). It refuses unless:
   - the commit is the current head of `staging` (so what you tested is what ships),
   - `main` is an ancestor (fast-forward possible; otherwise do the hotfix back-merge below),
   - `ci-ok` passed on that commit and the staging smoke test passes,
   - migrations in the range are confirmed applied.
4. It prints which services will redeploy, then waits for a **required reviewer** on the `production` environment. After approval it pushes the commit to `main` (never forced).
5. Vercel builds production only for apps whose code changed. When both show Ready, run **Post-deploy smoke** with the production URLs.

### Hotfix

Branch from `main`, PR into `main`, deploy. Then **merge `main` back into `staging`** through a PR; until that is done the promotion gate refuses (staging does not contain the hotfix). Never hotfix production without bringing it back to staging.

### Rollback

Per Vercel project: Instant Rollback / "Promote previous deployment" on the affected app. This never rolls back the database, which is why migrations are backward compatible (section 6).

## 3. Deploy only what changed

- Each Vercel project's `vercel.json` has `ignoreCommand: npx -y turbo-ignore@<pinned>`. On Vercel it compares against the **last successful deployment of that branch** (so a promotion containing many commits still builds only the apps that changed in that range), using the workspace graph.
- **First deploy of a new project** (no previous deployment) falls back to the last 10 commits and can skip a needed build: do the very first deploy of each project manually (Vercel dashboard "Deploy", or temporarily empty the Ignored Build Step) and confirm it builds.
- CI (`.github/workflows/ci.yml`) uses `scripts/ci-changes.sh` the same way; `ci-ok` is the single required check, so skipped jobs never block a merge.

| Change                                                       | Website deploys | Portal deploys                              |
| ------------------------------------------------------------ | --------------- | ------------------------------------------- |
| `apps/website/**` only                                       | yes             | **no**                                      |
| `apps/portal/**` only                                        | **no**          | yes                                         |
| `packages/ui\|types\|validation/**`, lockfile dependencies   | yes             | yes                                         |
| `supabase/**`, `docs/**`, `tests/**`, `.github/**`           | no              | no (apply migrations separately, section 6) |

Environment-variable changes never trigger a build: redeploy that project after changing them. `NEXT_PUBLIC_*` values are baked in at build time, so production is always **rebuilt from the tested commit with production variables** (the commit is identical; the binary is not moved between environments).

## 4. How the website and portal stay consistent

**Booking happens only in the portal.** The website's "Book appointment", "Manage booking", "My bookings" and "Sign in" buttons are links to `NEXT_PUBLIC_PORTAL_URL/<path>`. Anything booked is written to the shared database by the portal, so it appears in the portal immediately. The website only _reads_ published data from the same database and _sends_ callback requests to the portal.

The complete list of website-to-system links (the contracts):

1. Supabase public RPCs `hms_catalog` and `hms_public_content` (read-only, anon-executable). `hms_available_slots` is the public slot RPC used by the portal booking page.
2. `POST {portal}/api/public/inquiry` with `{name, phone, category, consent, token}`. CORS allows only `NEXT_PUBLIC_WEBSITE_URL`; needs `HMS_DEMO_MODE=false` and `HMS_CALLBACK_ENABLED=true` on the portal.
3. Links to portal pages `/book`, `/login`, `/manage-booking`, `/my-bookings`.

These are checked by `pnpm test:contracts` on every PR and by the post-deploy smoke test.

**Environment wiring is the real risk.** Within one environment both Vercel projects must use the **same** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `HMS_ORGANIZATION_SLUG`, `HMS_BRANCH_CODE`, and each must point at the other (`NEXT_PUBLIC_PORTAL_URL` on the website, `NEXT_PUBLIC_WEBSITE_URL` on the portal). **Staging projects point only at staging peers and the staging database; production only at production.** Never mix.

### Environment-variable ownership

| Variable group                                                                                     | Website | Portal |
| -------------------------------------------------------------------------------------------------- | ------- | ------ |
| `NEXT_PUBLIC_*` (Supabase URL/publishable key, site URLs, hospital details, Turnstile **site** key) | yes     | yes    |
| `HMS_ORGANIZATION_SLUG`, `HMS_BRANCH_CODE`                                                         | yes     | yes    |
| `HMS_PUBLIC_LIVE`, `HMS_ALLOW_INDEXING`                                                            | yes     | no     |
| `HMS_DEMO_MODE`, `HMS_NOTICE_*`, `HMS_CALLBACK_*`                                                  | no      | yes    |
| `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_*`, `HMS_RAZORPAY_MODE`, `HMS_ENABLE_REAL_PAYMENTS`         | **never** | yes  |
| `CRON_SECRET`, `RESEND_API_KEY`, `TWILIO_*`, `WHATSAPP_*`, `HMS_NOTIFY_*`, `HMS_PRIVATE_SCANNER_*` | **never** | yes  |

Staging uses its own Supabase project, Razorpay **test** keys, `HMS_NOTIFY_*=false` (no SMS/WhatsApp/email to anyone) and synthetic data. Never copy production patient data to staging.

### After every deployment

Run **Post-deploy smoke** (Actions tab) with the two URLs. It checks both sites respond, the PWA is only on `/login`, the website links to this portal, the portal accepts the website origin, and (live mode) that the portal catalog doctors appear on the website, proving both use the same database and branch. Locally: `node scripts/smoke-deployed.mjs --website ... --portal ... [--demo]`.

## 5. Why not one big service, and what it costs

**Keep two apps, do not merge them.** Vercel bills by seats and usage (bandwidth, function time, build minutes), not by project count (check current pricing), so merging website and portal saves almost nothing, while making a website edit redeploy the hospital portal, mixing server secrets into the public site and losing the PWA/indexing/CSP separation. **Do not add more deployables** until section 8's triggers are met.

Cost plan:

- Vercel **Pro** team (Hobby is non-commercial only) for the four projects; one set of seats.
- `turbo-ignore` plus CI path filters and `cancel-in-progress` avoid builds nobody needs; avoid preview deployments for docs-only changes.
- Supabase: production on a paid plan (backups, no inactivity pause); staging may stay on the Free plan, which pauses after about a week of inactivity (resume it from the dashboard before a test session) or move it to paid if that hurts.
- No always-on servers. The maintenance work (notification jobs, payment reconciliation, policy refunds) runs through the existing `GET /api/internal/maintenance` route with `Authorization: Bearer $CRON_SECRET`; call it from a scheduled GitHub Actions workflow (not created yet; needs `CRON_SECRET` stored as a repository/environment secret) or Vercel Cron if your plan allows.
- Staging uses `*.vercel.app` URLs; only production needs a custom domain.

## 6. Database releases (separate lane)

The database is shared by both apps and deploys at a different time, so it follows stricter rules.

1. Migrations are **append-only**. CI (`scripts/check-migrations-append-only.sh`) fails if an existing file is modified, deleted or renamed, or a new file is not named `YYYYMMDDnnnn_description.sql` and sorted after the latest one.
2. Be **backward compatible** (expand/contract): add columns/functions/versions first; deploy the apps that use them; remove the old thing in a later migration after nothing uses it.
3. Never change a frozen contract in place. Add a new RPC/endpoint version alongside the old one.
4. Order: **migration -> portal -> website**, staging first, then production.
5. Staging first: apply to the staging project, run `supabase/tests/verify_*.sql`, test. For production take a backup, apply in order, verify, then promote (the promotion workflow refuses until you confirm).
6. Keep `hms`/`hms_private` schemas unexposed; new `SECURITY DEFINER` functions need explicit REVOKE/GRANT (see the `hms-role-security-review` skill).

## 7. One-time setup checklist (manual)

- [ ] Vercel Pro team. Create `hms-website-stg`, `hms-portal-stg`, `hms-website-prod`, `hms-portal-prod` from this repo; Root Directory `apps/website` / `apps/portal`; Node 22; "Include source files outside of the Root Directory" enabled. Production branch: `staging` for the `-stg` projects and `main` for the `-prod` projects.
- [ ] Environment variables per section 4, separately for staging and production. Website projects get **no** secrets.
- [ ] First deploy of each project done manually and confirmed (section 3).
- [ ] Two Supabase projects (staging, production). Apply migrations in order; provision with `supabase/setup/01_provision_hospital.sql`; configure Auth (SMS, Turnstile, MFA, rate limits) in each.
- [ ] Razorpay: test keys and webhook `https://<staging-portal>/api/v1/payments/webhook` on staging; live keys only after sign-off, on production.
- [ ] Create the `staging` branch from `main`. GitHub rulesets for `staging` and `main` (PR + `ci-ok`, no force-push); `main` bypass for the promotion token only.
- [ ] GitHub Environment `production` with at least one required reviewer.
- [ ] Repository secret `PROMOTE_TOKEN` (fine-grained token or GitHub App token with contents write, allowed to bypass the `main` ruleset). If bypass is not possible, fall back to a PR `staging` -> `main` merged with a merge commit (same file tree, new commit id).
- [ ] Repository variables `STAGING_WEBSITE_URL` and `STAGING_PORTAL_URL` (and `STAGING_DEMO=true` while staging runs in demo mode).
- [ ] Rehearsal: a website-only change must build only `hms-website-stg`; after promotion only `hms-website-prod` builds and the portal project shows Ignored.

## 8. Service boundaries (modular monolith first)

| Service                                                     | Lives in                                                                      | Interface to others                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------- |
| Accounts / identity (Supabase Auth, memberships, RBAC, MFA) | database + `apps/portal/lib/server/supabase.ts`                               | `hms_staff_context` RPC, session cookie |
| Booking and appointments                                    | database RPCs + portal `/api/v1`                                              | RPCs, `/api/v1`                         |
| Payments and refunds                                        | portal `lib/server/razorpay.ts`, service-role RPCs                            | signed webhook, `/api/v1/payments/*`    |
| Clinical records and prescriptions                          | database + portal `/api/v2`, `/api/v3`                                        | RPCs only                               |
| Notifications                                               | durable jobs table, `lib/server/notifications.ts`, `/api/internal/maintenance` | DB outbox + scheduled call              |
| Reports                                                     | `hms_v3_reports` RPC, admin screens                                           | RPC                                     |
| Public content (CMS)                                        | database + website                                                            | `hms_public_content`                    |

Rules (enforced by the ESLint boundary rules and `pnpm test:contracts`):

- Apps never import each other; packages never import apps.
- Services talk through the database (RPC / outbox) or **versioned HTTP**, never by sharing internals.
- Server secrets exist only in the portal (and future server-side services), never in the website.

**Extract a module into its own `apps/<name>` deployable** (new Vercel/other project pair, own secrets, own pipeline entry) only when it needs an independent schedule or scale (notification worker, large report exports), a different secret set or compliance boundary, or a different release cadence/owner. Prefer scale-to-zero hosting (serverless/edge functions, scheduled jobs) over always-on servers. When that happens: add the app, add its two projects, add it to `scripts/ci-changes.sh` and the promotion summary, and add its contract checks.

Service charter (copy into the PR that introduces a service): `Name · Owner · Data it owns · Contracts it exposes (+ versions) · Contracts it consumes · Secrets it needs · Deploy lane and rollback · Health check / smoke test`.
