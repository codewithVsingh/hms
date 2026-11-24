# Test report

Branch `feature/hms-audit-security-hardening`, run on 24–25 Nov 2026 (re-run in full on 25 Nov after the Hindi work). Every result below was actually executed. Nothing here is estimated.

## Results

| Check | Command | Where | Result |
|---|---|---|---|
| Dependency audit | `pnpm audit --prod --audit-level=high` | local + CI | No known vulnerabilities |
| Formatting | `pnpm format:check` | local + CI | Pass |
| Lint | `pnpm lint` | local + CI | 0 errors, 22 warnings (HMS-028) |
| Static security tests | `pnpm test:security` | local + CI | 9/9 pass |
| Type check | `pnpm typecheck` | local + CI | Pass (2 apps) |
| Production build | `pnpm build` | local + CI | Pass (website 29 static pages; portal) |
| Browser E2E (demo mode) | `pnpm test` | local (Chromium) + CI | 69/69 pass (23 tests × desktop, mobile, tablet), including `tests/hindi.spec.ts` |
| Hindi coverage crawl | one-off Playwright crawl of 54 website and portal pages with `?lang=hi` (not committed) | local | English text left on screen: 641 occurrences / 123 distinct (was 2,009 / 605). What remains is names, UHIDs and references, the brand, sample clinical data, and demo CMS content (by design or pending decision) |
| Database: fresh install | `supabase/tests/local/run.sh` | local PG 16.15 + CI `postgres:16` | Migrations 001–023 apply (012 failed before the fix) |
| Database: verify scripts | same | local + CI | baseline, duplicates, live, phase3, phase4 pass |
| Database: behaviour T1–T9, T11–T15 | same | local + CI | All pass |
| Database: concurrency T10 | same | local + CI | 20 parallel bookings, 5 slots: 5 wins, 15 `SLOT_UNAVAILABLE`, max 1 per slot |
| Secret scan | Gitleaks (full history) | CI | Pass |
| Code scanning | CodeQL security-extended | CI | Pass |

Mutation checks proved the tests can fail: removing the `sameOrigin` CSRF guard fails the static test, and changing an expected deduction fails T6.

## Database behaviour coverage

| Test | Scenario (brief §20 item) |
|---|---|
| T1 | Anonymous callers can't book, read tables or reach staff RPCs (16) |
| T2 | Staff RPCs need MFA; admin sets doctor fee, schedule, slots, cancellation policy; optimistic policy versioning; admin can't change own roles (1, 3) |
| T3 | Unverified phone refused; stale policy and tampered fee rejected; idempotent retry; held slot can't be double-booked (4) |
| T4 | Order uses server amount; repeated pay click reuses the order; second concurrent claim blocked; order invisible to another user; wrong amount rejected; duplicate webhook and browser verify idempotent; booking limit (6, 7) |
| T5 | Another patient can't quote, cancel or look up a booking, even with the correct reference and name (8, 15) |
| T6 | Free cancellation outside 24 h; ₹100 deduction inside 24 h (test values); tampered amounts rejected; repeat confirmation idempotent; slot released and rebookable (9, 10, 11) |
| T7 | Partial refund claimed once; provider amount/ID mismatch rejected; settlement idempotent; admin can't start a second refund on the same payment (11, 12) |
| T8 | Receptionist reads appointments but can't approve refunds, change policy, fees or roles, or query tables (1, 16) |
| T9 | Booking, cancellation and policy changes are audited |
| T10 | Concurrent booking race (5) |
| T11 | Random unambiguous references (2,000 generated, all distinct); audit log rejects UPDATE/DELETE/TRUNCATE |
| T12 | Staff search by mobile (any format), booking reference and name; patients refused; each search audited without the search text |
| T15 | Duplicates: likely/possible levels; shared mobile alone, different DOB or gender are not matches; registration refused without reason, child on same mobile allowed, override reason recorded; legacy register and booking closed; DOB required, minors refused; new online record flagged silently; doctors and patients can't see queue; both-accounts merge blocked; first UHID survives; one pending merge per patient; reception can't approve; ID check required; rejection needs reason; approval moves appointment, encounter, prescription and online account; prescription keeps original UHID; old UHID finds survivor in search and doctor timeline; portal shows surviving UHID; undo restores everything; undo window enforced once set; proposer can't approve own and can cancel; all audited without names or phones |
| T14 | Prescription corrections: reception and other doctors can't amend; reason/attestation required; version 2 keeps release and flags the printed copy; version 1 superseded with items kept; one signed version enforced; patient sees only v2 and is notified; recall list and idempotent recall; amendment window closes at 72 h; withdrawal needs a reason; duplicate request refused; requester can't confirm; hidden while pending; reception can't see or decide; admin sees no medicines and must give a reason to reject; requester can cancel; second doctor approves; withdrawn hidden from patient and notified; history shows all versions and decisions; patients can't read history; nothing deleted; every step audited |
| T13 | Doctor unavailable: reception can't add leave; legacy leave still refuses; new leave records reason and reports 3 affected; new bookings blocked; patient can't see list or cancel; online booking → full refund requested, admin approval and provider confirmation → refunded; desk booking → desk refund recorded once; unpaid hold → no refund; desk refund never sent to Razorpay; patient sees full refund; all audited |

## Not yet covered (needs staging or further work)

- Real Supabase Auth flows: OTP expiry and rate limits, password reset, session expiry and refresh (18, 22). These depend on Supabase configuration and need a staging project.
- Razorpay test-mode end to end, with real webhooks and refunds.
- Patient history retrieval and document upload access (13, 17): code reviewed, DB tests to add.
- Live (non-demo) screens for reception registration and online booking with date of birth: covered at database level (T15); browser tests run in demo mode only.
- Hindi (19): covered by `tests/hindi.spec.ts` (new screens, old workspace, booking date chips, website, redirect keeps language) and the crawl above. Native-speaker and clinician review is not a test and is still needed.
- PWA installation, accessibility audit (20, 23): partly covered by existing E2E; a dedicated axe/Lighthouse pass is pending.
- Reports and exports (24).

## How to run locally

```sh
pnpm install --frozen-lockfile
pnpm format:check && pnpm lint && pnpm test:security && pnpm typecheck && pnpm build
pnpm exec playwright install chromium && pnpm test
# Database (needs PostgreSQL 15+ client and server; never point at a real project)
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres bash supabase/tests/local/run.sh
```
