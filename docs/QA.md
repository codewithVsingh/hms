> Historical Phase 1 document. For the current live implementation and limitations, use README.md, docs/LIVE-INTEGRATION.md, docs/API.md and docs/QA-PHASE2.md.

# QA verification — Phase 1

## Executed in the authoring environment

- TypeScript transpilation/syntax check: 29 source files, zero syntax diagnostics. This is **not** a complete TypeScript type check.
- JSON parse and CSS top-level parse: passed.
- Rendered UI using an isolated local Chromium component harness (transpiled source components with available React 16 compatibility runtime, not the actual Next.js 16 / React 19 runtime). No legacy runtime is included in the deliverable.
- 12 representative pages x 4 viewport sizes (1440 x 1000, 768 x 1024, 390 x 844, 320 x 700): 48 checks passed; no document-level horizontal overflow or rendering errors detected. Tables can intentionally scroll within their containers.
- 3 interactive checks passed: booking required date/time and simulated confirmation; staff appointment search, modal, check-in transition; doctor sample appointment assignment filter.
- No browser JavaScript exceptions observed in these checks.
- Screenshots are taken from rendered components, with reduced motion enabled for capture.

Total: 51 component-harness checks passed, zero failures. See `QA-results.txt` for individual checks.

## Still to run locally with installed dependencies

The package registry was inaccessible in the authoring environment, so `pnpm install`, full TypeScript checking, `next build`, actual Next routing/SSR/hydration, and the supplied Playwright suite against the real apps were not executed. The SQL migrations were authored but not executed against Supabase. There is no live auth, integration, security, clinical, payment or cross-browser certification. Browser compatibility should be verified on Chrome, Edge, Firefox, Safari and physical iOS/Android devices, including keyboard, screen-reader and reduced-motion testing, before production use.

Run from repository root:

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm test
```

Review and test migrations only against an isolated Supabase development project. Never use real patient data in QA.
