# Feature implementation status

Key: **Done** = implemented end to end (UI → API → DB) · **Done (tested)** = also covered by automated tests on a real database · **Partial** · **Config** = built, waits on external accounts or settings · **Missing**

"Done" means the code path exists and was traced through. It does not mean it has been validated on staging with real providers.

## Public website

| Feature | Status | Notes |
|---|---|---|
| Home, about, services/departments, facilities, FAQ | Done | Content from CMS when `HMS_PUBLIC_LIVE=true` |
| Doctor listing and profiles | Done | Only published doctors |
| Health library (articles) | Done | CMS with medical-review step |
| Policies (privacy, terms, cancellation and refund) | Done (content config) | Text must be written and approved by the hospital |
| Contact, click-to-call, WhatsApp chat link | Config | From `NEXT_PUBLIC_HOSPITAL_*`; no invented numbers |
| Callback / enquiry form | Done | Turnstile + origin check; requires `HMS_CALLBACK_ENABLED` |
| Booking, lookup, cancellation | Done | Handled by the portal (`/book`, `/manage-booking`) |
| Gallery | Missing | HMS-025 |
| SEO: sitemap, robots, metadata, JSON-LD | Done | Indexing off unless `HMS_ALLOW_INDEXING=true` |
| Custom 404 and error pages | Done (tested) | Error boundary added in this branch |
| Not a PWA | Done (tested) | |

## Booking lifecycle

| Feature | Status | Notes |
|---|---|---|
| Slot availability, schedules, slot length | Done (tested) | |
| Doctor leave blocks slots | Done | |
| Online booking with phone OTP | Done (tested) | |
| Temporary hold (10 min) and expiry | Done (tested) | |
| Server fee, policy acknowledgement, idempotency | Done (tested) | |
| Concurrent booking protection | Done (tested) | T10 |
| Unique booking reference | Done (tested) | Random since migration 019 |
| Payment order, verification, webhook, recovery | Done (tested at DB level) | Razorpay test mode to verify on staging |
| Receptionist / walk-in booking, registration | Done | |
| Rescheduling | Done | |
| Check-in, OPD tokens, queue | Done | |
| No-show, completion status | Done | |
| Reminders and notifications | Config | Providers not connected (HMS-023) |
| Doctor unavailable after booking (bulk handling) | Partial | Leave refused while bookings exist (HMS-016) |
| Waiting list | Missing | Roadmap |

## Patients and clinical

| Feature | Status | Notes |
|---|---|---|
| UHID (`PT-…`) | Done | Sequential by design (HMS-030) |
| Patient search (UHID, name, mobile, booking reference) | Done (tested) | Audited; T12 |
| Doctor timeline by UHID | Done | Paginated; access-checked and audited |
| Vitals, diagnoses, allergies, history | Done | Doctor only (HMS-021) |
| Prescriptions: draft, issue with attestation, print | Done | |
| Prescription amendment / voiding | Missing | HMS-017 |
| Paper prescription upload and verification | Config | Needs scanner |
| Documents: upload, signed download | Config | Needs scanner |
| Duplicate detection and merge | Missing | HMS-018 |

## Finance

| Feature | Status | Notes |
|---|---|---|
| Configurable fees | Done (tested) | |
| Offline cash/UPI/card collection | Done | |
| Receipts / invoices | Done | |
| Cancellation policy (versioned, time-based) | Done (tested) | |
| Partial and full refunds, approval, tracking | Done (tested at DB level) | |
| Refund reconciliation | Config | Worker + `HMS_RECONCILIATION_ENABLED` |
| Daily cash reconciliation, discounts | Missing | HMS-022 |
| Revenue and occupancy reports, CSV export | Done | Aggregates |

## Administration and platform

| Feature | Status | Notes |
|---|---|---|
| Team invites, role management | Done (tested) | |
| Settings, doctor publishing, schedules | Done (tested) | |
| CMS workflow (draft → medical review → publish) | Done | |
| Audit log | Done (tested) | Append-only since migration 019 |
| Portal PWA (install, offline page, no caching) | Done | Device install testing pending |
| English/Hindi | Partial | HMS-024 |
| Health check | Done (tested) | `/api/health` |
| CI security scanning | Done | |
| Backups and restore | Config | Procedure documented; drill pending |
