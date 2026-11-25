# HMS: agent instructions

Stack: pnpm + Turborepo monorepo, Next.js 16 / React 19 (`apps/website`, `apps/portal`), Supabase (`supabase/`), Playwright tests (`tests/`). Healthcare context: never connect real clinical records or live payments before verification is complete (see `docs/CURRENT-HANDOVER.md`).

## Skills first

Before starting any task (build, fix, review, deploy), check `.claude/skills/` and invoke the matching skill(s) FIRST, then do the work. Start with `using-agent-skills` if unsure which applies.

| Task | Skill(s) |
|---|---|
| New feature / unclear request | `grill-me` or `grilling`, then `spec-driven-development`, `planning-and-task-breakdown` |
| Implementing | `incremental-implementation`, `test-driven-development`, `source-driven-development` |
| API routes / module boundaries | `api-and-interface-design` |
| UI (website, portal, PWA, bilingual EN/Hindi) | `frontend-ui-engineering`, `vercel-react-best-practices`, `vercel-composition-patterns` |
| Database, RLS, auth, storage, migrations | `supabase`, `supabase-postgres-best-practices` |
| Bug / failing test / broken build | `debugging-and-error-recovery`, `diagnosing-bugs` (hard ones) |
| Security of patient/role/auth data | `security-and-hardening`; `security-audit` only on explicit audit request |
| "Can role X reach Y?", auth/RLS/API-route review | `hms-role-security-review` (HMS-specific, read-only) |
| QA / smoke test of a flow, roles, EN/Hindi, viewports | `hms-staging-qa` (HMS-specific, report-only) |
| Review / cleanup | `code-review-and-quality`, `code-simplification` |
| Performance, logging | `performance-optimization`, `observability-and-instrumentation` |
| Commits, CI, release | `git-workflow-and-versioning`, `ci-cd-and-automation`, `shipping-and-launch`, `documentation-and-adrs` |

Skills never override the rules in this file: no secrets in commits, no push/deploy/destructive git without explicit user approval.

## Verification (run before calling work done)

`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:contracts`, `pnpm test:security`, `pnpm test`.

## Releases and boundaries

Website, portal and database are separate release lanes sharing one Supabase DB. Read `docs/RELEASE-AND-SERVICES.md` before touching shared packages, migrations, public RPCs, `/api/public/inquiry`, portal URLs used by the website, or env vars. Migrations are append-only and backward compatible; the website never gets server secrets; apps never import each other.

## Adding more skills

Source library: `E:\agent-skills-library` (read its README safety checklist first; read each SKILL.md; avoid skills with `allowed-tools`, hooks, remote fetches or deploy commands). Copy the folder into `.claude/skills/` and record it in `.claude/skills/SOURCES.md`. Not installed but available if needed: `addyosmani-agent-skills/{deprecation-and-migration,browser-testing-with-devtools,idea-refine,interview-me}`, `coreyhaines31-marketingskills/*` and SEO skills (public website marketing). The two Tutors Parliament skills were adapted into `hms-role-security-review` and `hms-staging-qa`; keep `references/auth-surfaces.md` current when routes, roles or migrations change.
