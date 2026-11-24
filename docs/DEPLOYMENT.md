> Historical Phase 1 document. For the current live implementation and limitations, use README.md, docs/LIVE-INTEGRATION.md, docs/API.md and docs/QA-PHASE2.md.

# Environment and deployment

Development: local Next servers on ports 3000 and 3001. Supabase SQL can be prepared independently.

Staging: separate Supabase project, protected Vercel preview projects, demo-only synthetic data, Razorpay test mode when integrated. Add production build and E2E checks to branch protection. Pin the resolved dependency lockfile and change CI install to `--frozen-lockfile` after initial install.

Production: do not enable demo mode. Replace UI demo with authenticated data flows, approved hospital content, privacy/security and operational reviews, complete payment test/reconciliation, restore tests, incident workflow and acceptance testing. Choose matching deployment/database region as appropriate. Set env secrets server-only. Add database migrations as gated release steps, not automatic unreviewed schema changes. Avoid logging sensitive record payloads. Do not copy production clinical data to staging.
