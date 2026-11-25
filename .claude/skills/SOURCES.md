# Skill sources (copied unmodified from E:\agent-skills-library on 2026-11-25)

| Repo | Pinned commit | Skills |
|---|---|---|
| addyosmani/agent-skills (MIT) | 301b02b12bff98e4688e6984af6556802322bbde | spec-driven-development, planning-and-task-breakdown, incremental-implementation, test-driven-development, debugging-and-error-recovery, code-review-and-quality, code-simplification, security-and-hardening, api-and-interface-design, frontend-ui-engineering, git-workflow-and-versioning, ci-cd-and-automation, documentation-and-adrs, shipping-and-launch, observability-and-instrumentation, performance-optimization, source-driven-development, using-agent-skills |
| mattpocock/skills | 4ae2317ddb22b046e26455e4f9c9b3aaaf62212d | diagnosing-bugs, grill-me, grilling |
| supabase/agent-skills | c9be0e931b7930f7d02126d04774d904c381e7d7 | supabase, supabase-postgres-best-practices |
| vercel-labs/agent-skills | 1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62 | react-best-practices, composition-patterns |
| cloudflare security-audit-skill | c1c8a8c1471069fb0e188eeaff69b8e8db6564a8 | security-audit |

Reviewed before install: none declare allowed-tools or hooks; the only script is a template in diagnosing-bugs (not auto-run).

## Project-authored (HMS)

| Skill | Adapted from | Notes |
|---|---|---|
| hms-role-security-review | tutors-parliament-own-skills/tp-role-security-review | Rewritten for HMS principals (patient/doctor/staff/super_admin), `/api/v1-v3` catch-all routes, Supabase RPC/RLS, AAL2. Written 2026-11-25 from repo at commit abd58ff; not yet run against a live project. |
| hms-staging-qa | tutors-parliament-own-skills/tp-staging-qa | Rewritten for HMS flows, demo vs live mode, EN/Hindi, PWA. Report-only. |
