# Validation and acceptance matrix

## Executed in the authoring environment

- TypeScript syntax transpilation: 44 source files, 0 syntax diagnostics. This is not `tsc --noEmit` or a successful Next.js build.
- `node --experimental-strip-types --test tests/security-static.test.cjs`: six tests passed (HMAC correctness/tampering, raw webhook signature, test/live key gate, three static guard checks). Static SQL checks do not prove runtime DB authorization.
- Chromium limited demo component harness: 24/24 page/viewport checks (home, contact, demo booking, demo login, demo staff appointments, demo admin at 1440x1000, 768x1024, 390x844, 320x700). WhatsApp icon visible and safe fallback `/contact` verified on public pages. Harness is not Next.js and does not exercise the new React hook-based live screens. `docs/QA-integration-results.txt` contains run output. The earlier UI-preview QA (`docs/QA.md`) is historical only.
- Package install unavailable: npm registry DNS error EAI_AGAIN. No live Next.js build/typecheck, Postgres migration execution, live UI integration, provider sandbox execution or Safari/Firefox run was possible here. Do not deploy as production-ready based on these results.

## Required staging acceptance before real patient/payment use

Use new Supabase dev project, provider test account, synthetic users/patients, and separate staging portal URL. Apply SQL and run `verify_baseline.sql`, `verify_live.sql`. Verify all ten migrations, RPC signatures, and grants. Then execute these checks and record evidence.

| ID | Scenario | Expected |
|---|---|---|
| AUTH-01 | Staff email/password + first TOTP enrolment | Valid AAL2, appropriate workspace |
| AUTH-02 | Wrong login/OTP/TOTP, patient account attempts staff route | Fail closed; no workspace access |
| AUTH-03 | Logged-in doctor requests another doctor's appointment/draft by ID | Rejected; no data disclosure |
| AUTH-04 | Billing user attempts clinical query, receptionist tries financial admin | Forbidden |
| AUTH-05 | Revoke role or membership during session | Next RPC fails; no stale privilege |
| AUTH-06 | Direct anon/authenticated calls to service-only RPCs and private schemas | Denied |
| AUTH-07 | Cross-origin POST and absent/invalid origin | Rejected |
| AUTH-08 | CAPTCHA expired/missing, OTP resend/rate limits | No uncontrolled OTP sends; correct feedback |
| BOOK-01 | Published doctor with weekly schedule and generated inventory | Real available dates/times; no expired/blocked slots |
| BOOK-02 | Patient verifies SMS, accepts notice, confirms pay-at-hospital | Appointment, invoice, consent, ownership/history and care assignment persisted |
| BOOK-03 | Concurrent online and reception booking same slot | Only one succeeds; no double booking |
| BOOK-04 | Replay same booking request ID | Same booking; no duplicate invoice |
| BOOK-05 | Doctor fee changes after review | Reject stale quote, reload correct price |
| BOOK-06 | Expired hold followed by another booking | New appointment allowed; old hold cannot confirm |
| BOOK-07 | User A requests user B booking/payment data | Denied |
| BOOK-08 | Cancel unpaid future visit and rebook | Slot released; invoice void; new booking valid |
| BOOK-09 | Paid cancellation, stale/expired slot and future booking limits | Correct review/limit state, no unsafe auto-confirm |
| BOOK-10 | Schedule disabled / doctor unpublished / booking off | New online availability closed; existing bookings not overwritten |
| PAY-01 | Create Razorpay test order | DB-priced amount, INR and one order per invoice |
| PAY-02 | Successful test checkout | Captured payment verifies; appointment confirmed, invoice settled |
| PAY-03 | Invalid callback/webhook signature, wrong order, amount, currency | No confirmation/settlement |
| PAY-04 | Duplicate callback, duplicate webhook, parallel deliveries | One payment record, no duplicate confirmation |
| PAY-05 | Close browser after capture | Webhook confirms; My Bookings recovers status after re-auth |
| PAY-06 | Declined/dismissed checkout | No false paid state; existing order may be reused while held |
| PAY-07 | Captured after hold expires / another visit occupies slot | Reconciliation-required; no double booking; admin review |
| PAY-08 | Network loss after gateway order create, before DB attachment | Claim prevents duplicate order; manual review with receipt |
| PAY-09 | Reception records cash twice | Only one payment; invoice settled once |
| PAY-10 | Approve full Razorpay refund in admin finance | One refund claim, matched provider ID/amount; processed status verified |
| PAY-11 | Refund provider timeout, duplicate approval, failed refund | No auto-repeat; verify in provider dashboard |
| PAY-12 | Test/live key mismatch | Fail closed; no real charge |
| OPS-01 | Register patient, find MRN, book reception | Persisted data and correct role scope |
| OPS-02 | Check in, start consultation, save multiple draft versions, complete | Legal state transitions; correct version history and read-only completed draft |
| OPS-03 | Admin reviews audit, team and payments | Branch-scoped data, no clinical access without explicit clinical role |
| CMS-01 | Draft → medical review → approved → published | Correct role gates; only published content on website |
| CMS-02 | Archive entry | Removed from public pages/sitemap |
| WEB-01 | Live website with real content; WhatsApp/contact and booking links | No fictional doctors/fees, valid actual contact links |
| WEB-02 | Indexing off/on and public sitemap | Correct robots; portal never indexed |
| WEB-03 | Live booking/login/portal at 320,390,768,1440; keyboard, screen reader, reduced motion | Responsive, accessible, no unintended overflow or disclosure |
| SEC-01 | Browser console/network/log review, cache headers, storage, abuse/rate limits | No credentials, OTP, medical notes or payments in logs/analytics |
| SEC-02 | Backup restore and disaster recovery test | Restore validated, including future document storage strategy |

Pending independent clinical/privacy and healthcare legal review is a release blocker, not a setup checkbox. Test the actual DB and provider transactions, including simultaneous and out-of-order requests, before accepting any live payment.
