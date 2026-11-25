---
name: hms-staging-qa
description: Exploratory, evidence-based QA of the HMS website and patient/staff portal on LOCAL demo or a STAGING deployment using browser automation (Playwright) — public site, callback form, patient booking (slot → details → payment in test mode), My Bookings / manage-booking / cancellation and refund views, patient history, staff (reception), doctor and admin workspaces, EN/Hindi switching, mobile/tablet/desktop layouts, PWA behavior. Reports bugs with reproducible steps, severity and screenshots and untested areas; does NOT change code, data models or tests. Use when asked to "QA", "smoke test", "check this flow" or verify a change. Never touches production or real patient data.
---

# HMS Staging QA (report-only)

Manual-style exploratory layer on top of the automated suites (`pnpm test:security`, Playwright specs in `tests/`). Use it for flows, roles and viewports those specs do not cover. For test-writing use `test-driven-development`; for authorization depth use `hms-role-security-review`.

## Hard limits (stop if any cannot be met)
- **Environment:** `http://localhost:3000` (website) and `http://localhost:3001` (portal), or a staging URL the owner gives you in this conversation. **Never production**, never a URL you were not given.
- **Mode awareness — state it in the report:**
  - **Demo mode** (`HMS_DEMO_MODE=true`, the default for local/CI): synthetic data, any role reachable from `/login`, bookings/payments are simulated ("Simulated payment successful. No money was collected."), `/api/v1|v2|v3` return 503. This verifies **UI, flow logic, layout, language and accessibility only — nothing about authentication, authorization, database or real payments.**
  - **Live/staging mode** (`HMS_DEMO_MODE=false`, synthetic data, dev/staging Supabase, Razorpay **test** mode only): needed for auth, MFA, RLS, real booking/payment/refund behaviour.
- **Accounts:** only synthetic staging accounts the owner provides. Staff accounts need TOTP; patient accounts use OTP to a number the owner supplies. Never invent or guess credentials; never write passwords, OTPs, TOTP secrets or tokens into files, reports or chat. Ask the owner.
- **No real-world side effects:** no real money (`HMS_RAZORPAY_MODE=test`, `rzp_test_` keys, `HMS_ENABLE_REAL_PAYMENTS=false` — if the portal shows live keys/real payments enabled, **stop and report**), no SMS/emails/WhatsApp to real people, no real patient data, no deleting or editing data you did not create, no admin mutations (settings, roles, publish, refunds) unless the owner explicitly scopes them.
- **Report-only:** do not edit code, migrations, env, flags or tests. Do not fix as you go.
- **Privacy:** screenshots/notes must not contain real PHI, secrets or phone numbers; redact. Save evidence outside the repo (scratchpad/temp folder).
- **Ports:** check `:3000`/`:3001` first. If the app is already running reuse it; otherwise start with `pnpm dev` (or `HMS_DEMO_MODE=true pnpm dev`) and stop what you started when done.

## Procedure
1. **Scope & plan.** State flow(s), environment, mode (demo/live), roles/accounts (by label only) and what "working" means. Take expected behaviour from the docs (`docs/CURRENT-HANDOVER.md`, `docs/PHASE3-HANDOVER.md`, `docs/API.md`, `docs/LIVE-INTEGRATION.md`), not from guesswork.
2. **Pre-flight.** Confirm both apps respond (`GET /` on 3000, `GET /login` on 3001). Note git commit (`git rev-parse --short HEAD`) and whether the tree is clean. If browser automation is unavailable (e.g. Playwright MCP failed to connect), use the repo's Playwright (`pnpm exec playwright ...`) via a throwaway script kept **outside** the repo, or say so and stop rather than inferring results.
3. **Walk each flow like a user.** Per step record: action, expected, actual, URL, console errors, failed network requests (own `/api/*` 4xx/5xx), screenshot at each decision point. Always cover: happy path, invalid input, back/refresh mid-flow, double-click/duplicate submit, empty/error/slow states, keyboard-only navigation, and viewports **1440×1000, 768×1024, 390×844, 320×700** (check no horizontal page overflow; tables may scroll in their own container).
4. **HMS flows** (pick what is in scope):
   - *Public website:* home, doctors directory → profile, services/health-library/FAQ/campaign pages, `/request-callback` form (validation, captcha behaviour, success/failure message, no PHI collected beyond form), WhatsApp float link (`/contact` fallback), privacy/refund pages, robots/sitemap (indexing off unless approved), no tracking scripts on booking/portal pages.
   - *Patient (portal `/book`, `/my-bookings`, `/manage-booking`, `/patient`, `/login`, `/forgot-password`, `/reset-password`):* date → slot → details → consent notice → payment; required-field and past-date validation; slot-unavailable and fee-changed messages; booking limit; confirmation reference; My Bookings list; cancel eligible unpaid booking vs paid-cancellation → "contact hospital" path; cancellation quote/policy wording and refund status; patient history/timeline; document upload limits (size/type); OTP/recovery generic error messages (no account enumeration).
   - *Staff / reception (`/staff/*`):* appointment search/filter, view details, check-in and status transitions (only valid ones offered), register patient, reception booking, queue, offline payment collect, billing/payments screens.
   - *Doctor (`/doctor/*`):* only assigned appointments/patients visible, consultation draft save/version, read-only after completion, prescriptions, availability/leave.
   - *Admin (`/admin/*`):* dashboard, doctors, schedules/slot generation, roles & permission matrix display, audit log, settings, content workflow (draft → review → publish), refund candidates.
   - *Cross-cutting:* **EN ↔ Hindi** toggle (every visible string translated, no clipped/overflowing Devanagari text, dates/numbers/currency formatted, language persists across navigation, `lang` attribute updates); Asia/Kolkata times shown correctly; PWA (manifest start_url `/login`, offline fallback shows generic message, **no patient data cached offline**); focus states, labels, headings, modal focus trap, `prefers-reduced-motion`; unknown routes show the not-found page.
5. **Access checks (read-only).** In **demo mode** role pages are intentionally open — report that as expected context, not as a bug. In **live mode**: while signed in as one role, confirm other roles' pages and staff API actions are refused (redirect to `/login` / 401 / 403 / not found), patients cannot see other patients' data, and staff without TOTP (AAL1) cannot reach staff data. Any exposure of PHI = **Critical**: stop probing and report immediately.
6. **Classify** each finding: Critical (PHI exposure, wrong access, money/payment/refund wrong, wrong clinical data) · High (core flow blocked or wrong result) · Medium (degraded/confusing, a11y blocker, Hindi missing in a key flow) · Low (cosmetic). Mark *reproduced N/N*.
7. **Report** (below). Suggest missing automated regression tests as one-liners (e.g. "Playwright: cancel unpaid booking shows refund wording"); do not write them.

## Report format
- **Scope & environment** (URLs, mode demo/live, commit, accounts by role label only, date/time, browser + viewports)
- **Summary** (counts by severity; go / no-go recommendation for the tested flow; one line on what demo-mode testing can and cannot prove)
- **Findings**, most severe first: title · severity · steps to reproduce · expected vs actual · evidence (redacted screenshot/console/network file names) · suspected area (route/component, flagged as a guess) · suggested regression test
- **Passed checks** (so absence of a bug is meaningful)
- **Not tested** (flows, roles, devices, payments, notifications, live auth, anything skipped and why)
- **Side effects** (records created on staging, processes started) so the owner can clean up
