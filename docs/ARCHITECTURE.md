> Historical Phase 1 document. For the current live implementation and limitations, use README.md, docs/LIVE-INTEGRATION.md, docs/API.md and docs/QA-PHASE2.md.

# Architecture and design handoff

## Deployable units

```
Public website (Vercel) ---- published catalog / content (future server endpoint)
         | Book visit
         v
HMS portal (Vercel) ---- app routes: doctor, staff, admin, book
         | future server-only DAL / service layer
         v
Supabase Postgres / Auth / private Storage
         + future Razorpay orders + signed webhooks
         + future durable notification jobs (Supabase / Railway)
```

Two independent web apps; one workspace and design system. The website has no clinical data or tracking script, and booking uses the portal origin. Mock data is deliberately bundled in the demo; no real record must ever be bundled into a client app. Server-only packages are placeholders until Phase 2. No API routes pretend to complete live operations.

## Design decisions

Teal, cream and ink healthcare palette; lightweight vector artwork drawn in source, CSS transitions, floating hero cards, page entry animation and reduced-motion support. Navigation collapses to a mobile menu, portal sidebar becomes a drawer, tables scroll within their container, cards and forms reflow at smaller breakpoints. Modern-browser targets align with Next 16; real device testing remains necessary. WCAG-oriented focus, headings, labels and modal focus behavior are included, but no formal accessibility audit is claimed.

## Production integration gates

1. Replace fictional hospital name, address, verified registration/doctor credentials, services, approved policies and fees; clinically review all content. Build a real CMS adapter and safe published projection. Add validated structured data (Hospital/Physician/BreadcrumbList as applicable) only for real data. Verify canonical URLs and metadata; enable indexing only when ready. No fake reviews, fabricated accreditation, ratings or patient testimonials.
2. Apply migrations on a dev Supabase project. Implement server-side Supabase Auth invite login, MFA, session validation, role/membership revocation and account provisioning. Use explicit branch scope and assigned-care access. Validate claims server-side, never derive authorization from route paths. Use least privilege, test cross-tenant and cross-role access. Keep private schema unexposed. Implement append-only clinical versions and immutable audit records.
3. Implement transactional slot holds, expiry/reconciliation, server-set fee, locked concurrency, status history, rescheduling, cancellation and verified payment confirmation. Server creates Razorpay orders and verifies captured payments and webhook signatures. Persist event ID and idempotency key, reconcile delayed/duplicate events, handle late capture/refund. Keep payment and appointment status independent. Require operational approval before enabling booking/payment flags.
4. Add secure uploads, signed URL scope verification, malware scanning, clinical document access audit, object backups, encrypted database backups and restore drill. Configure privacy/consent/retention policies; avoid PHI in monitoring and analytics. Add CSP for all script/resource sources once integrations are defined, rate limiting, CSRF defenses, no-store private responses and secure cookies.
5. Add notification queue/outbox, delivery retries, non-sensitive notification templates, monitoring and alerting. Railway worker only if persistent tasks justify it. Marketing attribution should be public-only and privacy reviewed, without clinical data or identifiers. No trackers on booking, portal or payment pages.

## Demo route behavior

Portal routes are allowlisted per role, but the user can intentionally select a different role from /login. No actual security boundary is implied. Real Auth will replace this preview, not simply hide buttons. The same sample data is reinitialized per route; changes are not shared between pages or apps. Use the database integration plan, not browser storage, for future persistence.
