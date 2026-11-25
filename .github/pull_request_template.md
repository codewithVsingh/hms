## What changed and why

## Release lane (tick everything this PR touches)

- [ ] Website only (`apps/website`)
- [ ] Portal only (`apps/portal`)
- [ ] Shared package (`packages/*`): **deploys BOTH website and portal**
- [ ] Database migration (`supabase/migrations`): additive only, applied to staging first
- [ ] CI / tooling / docs only (no deployment)

## Cross-service safety

- [ ] No change to a frozen contract (public RPCs, `/api/public/inquiry` body, portal URL paths used by the website, `/api/v1..v3`) — or a new version was added alongside the old one
- [ ] No environment variable added/changed — or the change is listed below for each Vercel project (website vs portal) and environment (staging vs production)
- [ ] No server secret added to the website project
- [ ] Rollout order if more than one lane: database -> portal -> website

## Verification

- [ ] `pnpm format:check && pnpm lint && pnpm test:contracts && pnpm test:security && pnpm typecheck && pnpm build`
- [ ] Playwright (`pnpm test`) or a note on why it is not needed
- [ ] After staging deploy: `post-deploy-smoke` workflow passed

## Env / rollout notes
