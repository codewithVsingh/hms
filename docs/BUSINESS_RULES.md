# Business rules

The single reference for how the HMS behaves. Every rule here is **enforced on the server** (database functions or API), not only in screens. "Where" names the enforcing function (`supabase/migrations`) and "Test" names the automated test that proves it (`supabase/tests/local/10_behaviour.sql` T-numbers, or the browser spec).

**Keeping this current:** any change to a rule updates this file, the decision log (§16) and a test, in the same pull request. The PR template asks for it.

Money is always in paise (₹1 = 100 paise) and currency is INR. Times are stored in UTC and shown in the branch time zone (default Asia/Kolkata, IST).

---

## 1. Hospital settings

| Setting | Default | Who changes it | Effect |
|---|---|---|---|
| Online booking on/off | Off | Admin (`settings.manage`) | Patients can't book or self-reschedule when off. Turning it on requires the privacy notice version and URL to be configured. |
| Online payment on/off | Off | Admin | "Pay online" is offered only when on and the fee > 0. Turning it on requires valid Razorpay keys and webhook secret. |
| Consultation fee | Per doctor | Admin | Taken from the server at booking. The browser's amount is never trusted. |
| Cancellation fee and free-cancellation window | ₹0, 24 hours | Admin | Versioned; see §5. |
| Prescription amendment window | 72 hours | Database setting (`hospital_settings.rx_amend_hours`, 1–720) | See §7. |
| Merge undo window | None (no limit) | Database setting (`hospital_settings.merge_undo_days`, empty or 1–3650) | See §10. Revisit after the first 3–6 months. |
| Doctor published | No | Admin | Only published doctors appear on the website and accept online bookings. |

Where: `hms_admin_settings`, `hms_admin_doctor`, `hms_v4_policy_set`. Test: T2.

## 2. Accounts and access

- **Patients** sign in with a mobile number and OTP. One verified mobile account maps to one patient record per hospital.
- **Staff** use email and password **plus TOTP (MFA)**. Every staff action is refused without an MFA session (`aal2`). (T2)
- Staff are invited by an admin. There is no staff self-registration. Invites can grant receptionist, billing, nurse or content manager only (`hms_v3_link_invite`).
- Nobody can change their own roles. Only `roles.manage` (super admin) changes roles, and every change is audited. (T2, T8)
- Doctors see clinical data only for patients they have an active **care assignment** with. An assignment is created when an appointment is confirmed, and revoked when the patient's last qualifying appointment with that doctor is cancelled.
- The full permission matrix is in [ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md).

## 3. Booking

| Rule | Detail | Where | Test |
|---|---|---|---|
| Who can book online | Signed-in patient with a **verified mobile**, aged 18+ (declared **and** checked against the date of birth), who accepts the current privacy notice | `hms_v7_book_self`, `hms_book_self` | T3, T15 |
| Date of birth | **Required** for online booking (since migration 023). Stored on a new record, or filled in when the record has none. An existing date of birth is never overwritten by the patient. | `hms_v7_book_self` | T15 |
| Name match | A returning patient must use the name on their record; otherwise reception helps | `hms_book_self` | — |
| Booking horizon | Up to 30 days ahead (branch time zone) | `create_appointment` | — |
| Slot validity | Slot enabled, in the future, inside the doctor's weekly schedule, not during leave, doctor active in the branch | `create_appointment` | T13 |
| One booking per slot | At most one live appointment per slot (unique index), also under simultaneous attempts | `one_live_appointment_per_slot` | T3, T10 |
| Double-click safety | The same request ID returns the same booking | `booking_request_unique` | T3 |
| Fee | Server fee; if the screen showed a different fee, the booking is refused (`FEE_CHANGED`) | `create_appointment` | T3 |
| Cancellation policy acknowledgement | The patient must have seen the current policy version; otherwise `POLICY_CHANGED` | `hms_v4_book_self` | T3 |
| Limits per account | At most 3 active future online bookings, and at most 8 online bookings per hour | `hms_book_self` | T4 |
| Pay online | Booking is **held for 10 minutes** for payment, then expires and frees the slot | `create_appointment`, `expire_slot_holds` | T3 |
| Pay at hospital | Booking is confirmed straight away; the invoice stays open until collected | `create_appointment` | T6 |
| Reception / walk-in booking | Reception books for a registered patient; always "pay at hospital"; idempotent per request | `hms_staff_book` | — |
| New online record | If the booking creates a new patient record that looks like an existing one, it is flagged for reception **silently**. The patient never sees other records. | `hms_v7_book_self` | T15 |
| Booking reference | `BK-` + 7 random characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O/1/I/L); unique; not a secret | `assign_short_booking` | T11 |
| Consent | Each booking and registration records a consent entry with the notice version | `create_appointment`, `hms_staff_register` | — |

## 4. Payments

- Online payments use Razorpay **test mode** unless `HMS_RAZORPAY_MODE=live`, `HMS_ENABLE_REAL_PAYMENTS=true` and an `rzp_live_` key are all set.
- The server creates the payment order with the server amount. There is one order per invoice; repeat "Pay" clicks reuse it. (T4)
- A booking is confirmed only after the server re-fetches the payment from Razorpay and the order, amount and currency all match. A browser "success" alone never confirms. (T4)
- Webhooks are verified by HMAC signature over the raw body. Duplicate events are processed once. (T4)
- A payment captured **after** the hold expired, after the slot passed, or during doctor leave does not confirm the booking. It goes to *reconciliation*, for an admin to refund.
- Desk payments (cash, UPI, card, bank transfer) are recorded by billing (`payments.collect`) for "pay at hospital" bookings only, once per invoice. (`hms_collect_offline`)
- Card details are never stored. Razorpay holds them.

## 5. Patient self-cancellation

- Available only for **online bookings made by the same verified account**. Reception-created bookings are cancelled by reception. (T5)
- Lookup needs the verified mobile session **and** the booking reference plus either the UHID or the name. A reference plus a name alone, from another account, finds nothing. (T5)
- Eligible: held or confirmed bookings whose start is in the future, either unpaid or paid once online with nothing unusual. Anything else goes to reception review.
- **Charge:** if cancelled **less than `free_cancel_hours`** before the start, the cancellation fee applies, capped at the amount paid. Otherwise there is no charge. (T6)
- The policy (fee, hours, version) is **snapshotted on each booking at booking time**. Later policy changes apply only to new bookings.
- The patient sees paid, deduction, refund and the estimated timeline before confirming. The server recalculates, and any difference is refused (`QUOTE_CHANGED`). Confirming twice returns the same outcome. (T6)
- The refund is created as **requested**. An admin approves it (`refunds.approve`), or it starts automatically if `HMS_AUTO_POLICY_REFUNDS=true`. (T7)
- Shown estimate: "usually 5–7 working days after the refund is initiated", subject to bank and payment method.

## 6. Doctor unavailability and hospital-initiated cancellation

| Rule | Detail | Where | Test |
|---|---|---|---|
| Who records leave | Admin, or the doctor for their own schedule. Reason required: planned leave, unwell, emergency, training, hospital holiday, other. Maximum 90 days per entry. | `hms_v5_leave_add` | T13 |
| Effect | Saved even when patients are booked. From that moment: no new bookings, no reschedules into the period, and late payments go to reconciliation. | `create_appointment`, `hms_v3_reschedule`, `hms_capture_payment` | T13 |
| Affected list | Reception/admin see live bookings overlapping current or future leave. The phone is shown only to roles that may read demographics. | `hms_v5_affected_bookings` | T13 |
| Options per booking | **Reschedule** to another time with the same doctor (patient notified), or **cancel as hospital** | `hms_v3_reschedule`, `hms_v5_hospital_cancel` | T13 |
| Hospital cancellation | Reason required (doctor unavailable, hospital closure, other). **Always a full refund, never a fee.** Repeating returns the same result. | `hms_v5_hospital_cancel` | T13 |
| Refund route | Online payment → refund requested → admin approval (or automatic). Desk payment → **Desk refunds** list; billing hands the money back and records the method. Unpaid → invoice voided. | same; `hms_v5_record_desk_refund` | T13 |
| Unusual payments | Several payments, pending reconciliation or earlier refunds → refused (`PAYMENT_REVIEW`); an admin handles it from Refunds | `hms_v5_hospital_cancel` | — |
| Desk refunds | Never sent to Razorpay; always the full payment; recorded once | `hms_v4_claim_requested_refund`, `hms_v5_record_desk_refund` | T13 |
| Staff cancellation (other reasons) | Reception/admin can cancel held or confirmed future bookings. A paid online booking is then refunded in full through the admin refund screen. | `hms_staff_cancel`, `hms_refund_claim` | — |

## 7. Prescriptions

**Issuing**
- Only the assigned doctor (`prescriptions.issue`), during the consultation (`in_consultation`), with a medical registration number on file.
- 1 to 25 medicines. Each has a medicine, dose, frequency and duration; instructions are optional and up to 500 characters. The follow-up date can't be in the past.
- The doctor must tick the attestation. This is an authenticated attestation, **not** a certified digital signature.
- One current (signed) prescription per consultation, enforced by a unique index. The doctor chooses whether to release it to the patient portal.

**Corrections** (decided 25 Nov 2026; migration 022)

| Rule | Detail | Test |
|---|---|---|
| Never edit or delete | Every correction creates a new row; earlier versions stay in the clinical record | T14 |
| Who amends | **Only the doctor who issued it**, who must still have clinical access to the visit. Other doctors write a new prescription. | T14 |
| Amendment window | **72 hours from the first issue** of that prescription (not from the last amendment), set by `rx_amend_hours`. After that: write a new prescription. | T14 |
| Amending | Creates version N+1 and marks version N **superseded**. Reason required (typing error, dose/frequency, wrong medicine, instructions, follow-up date, other); "other" needs an explanation. The doctor attests again. | T14 |
| Portal release | The amendment keeps the previous version's release setting, so a correction can't silently hide a prescription | T14 |
| Patient view | Only the current version, marked "Updated · replaces version N of [date]"; superseded and withdrawn versions are never shown | T14 |
| Notifications | Every amendment notifies the patient (opted-in channels) with no clinical content: "A prescription in your patient portal was updated…" | T14 |
| Paper copies | If the replaced version was printed or handed over on paper, reception sees it under **Paper copies to recall** until marked recalled | T14 |
| Printouts | Show the version number and "Replaces version N issued on…". Superseded or withdrawn printouts say "not valid, do not dispense". | E2E |
| Withdrawal (two-person rule) | For a prescription that should not exist (wrong patient, issued in error, duplicate, other). The **issuing doctor requests** (no time limit); a **different person confirms**: another doctor in the branch or an administrator. The requester can never confirm their own request. | T14 |
| While pending | Hidden from the patient portal (reversible privacy measure: it may contain another patient's medicines); can't be amended or handed over; the requester can cancel the request | T14 |
| Decision | Confirm → **withdrawn** (permanently hidden from the patient, kept for clinicians, patient notified "…was withdrawn, contact the hospital"). Reject → a reason is required; the prescription becomes visible again. | T14 |
| Who sees what | Doctors confirming see the medicines; administrators see the reason, not the medicines. Version history (all versions, reasons, decisions) is for clinicians with care access only; patients can't read it. | T14 |
| Audit | Amend, withdrawal requested/cancelled/approved/rejected, recall, and history reads are all audited | T14 |
| Reception | Can record handover, archive scanned paper prescriptions and mark recalls; **can't** change clinical content | T14 |

## 8. Visit flow

`confirmed → checked_in → in_consultation → completed`, plus `no_show` and `cancelled`/`expired`.
- Check-in and no-show: reception (`appointments.checkin`). No-show is only possible after the start time.
- In consultation and completed: the assigned doctor.
- On check-in, the patient gets the next **OPD token** for that day and branch (sequential, unique per day).
- Every status change goes to the status history and the audit log.

Where: `hms_change_status`, `v3_queue_token`.

## 9. Rescheduling

- Staff (`appointments.create`) can reschedule any branch booking. Patients can reschedule their own online bookings while online booking is on.
- Same doctor only; the new slot must be valid (§3), within 30 days and not during leave.
- Only confirmed bookings, whose current slot is still in the future, and whose payment isn't mid-flight, being reconciled or refunded.
- The invoice and booking reference are kept. The patient is notified ("appointment changed"), and earlier reminders are replaced.

Where: `hms_v3_reschedule`.

## 10. Patients, records and duplicates

**Identity**
- Every patient has a permanent **UHID** `PT-` + at least 6 digits (sequential, by decision). It is separate from booking references.
- Reception registers walk-ins: name required; mobile, date of birth and gender optional; consent recorded.
- Demographic corrections by reception are audited.

**Search and timeline**
- Staff search: name or UHID (partial), mobile (last 10 digits, any formatting), booking reference (exact) or a **former UHID** of a merged record. Each search is audited **without storing the search text**. (T12, T15)
- Doctor timeline by UHID needs a care assignment; it is paginated (25 visits) and audited. A former UHID opens the surviving record and lists the former UHIDs. If an unresolved duplicate flag exists, the doctor sees only "may have another record, ask reception", with no details about the other record. (T15)

**Duplicate detection** (decided 25 Nov 2026; migration 023)

| Rule | Detail | Test |
|---|---|---|
| Never automatic | Nothing is ever merged without two people | T15 |
| Name comparison | Titles (Mr, Mrs, Smt, Shri, Dr, Baby…) ignored; punctuation and word order ignored; common variants unified (Mohd/Md/Mohammad → Mohammed, Laxmi → Lakshmi, Kr → Kumar); repeated letters collapsed; "similar" = trigram similarity ≥ 0.45 | T15 |
| **Likely** | Same mobile + similar name + same date of birth | T15 |
| **Possible** | Same mobile + similar name + date of birth missing on one side, or day and month swapped; **or** similar name + same date of birth (different or no mobile) | T15 |
| **Not a match** | Same mobile alone (families share phones) · different gender (both recorded) · both dates of birth known and different (not a swap) | T15 |
| Reception registration | Before saving, matches are shown with UHID, name, date of birth, last visit and **only the last 4 digits** of the mobile. Reception picks **Use this patient**, or **Register new patient anyway** with a reason (5–300 characters), which is recorded against each match. The server refuses to register while matches exist and no reason is given (`POSSIBLE_DUPLICATE`). | T15 |
| Review queue | Reception and admin see open flags (from online bookings and record checks), each pair side by side. **Not the same person** needs a reason. | T15 |

**Merging**

| Rule | Detail | Test |
|---|---|---|
| Who | **Proposed** by reception or an admin (roles that read branch demographics). **Approved only by an administrator** (`settings.manage`) who is **not** the proposer. Doctors can't see the queue or propose; they ask reception. | T15 |
| ID check | The approver must record which identity document was checked (Aadhaar, PAN, passport, driving licence, voter ID, other government ID). **The document number is never stored.** | T15 |
| Surviving UHID | The record **registered first always keeps its UHID**. The other UHID becomes an alias: searching or opening it finds the surviving record, so old paper files still work. | T15 |
| What moves | Appointments (with their visits, notes, vitals, diagnoses, prescriptions and paper archives), care assignments, documents, history, consents, contacts the survivor lacks, the online account link, notification preferences the survivor hasn't set | T15 |
| What stays | Prescriptions keep the patient name and UHID they were issued under (true historical record). Duplicate contacts and preferences stay on the merged record. | T15 |
| Conflicting details | Where name, date of birth or gender differ, the approver chooses which value to keep; the default is the surviving record's. | T15 |
| Blocked | Both records have separate verified online accounts (`BOTH_HAVE_ACCOUNTS`): two logins are treated as two people. Only one pending merge per patient at a time (`MERGE_PENDING`). | T15 |
| Rejecting | Needs a reason. The proposer can cancel their own pending proposal. | T15 |
| Undo | An administrator can undo with a reason. Everything moved returns; records created after the merge stay with the survivor. **No time limit** while `hospital_settings.merge_undo_days` is empty (the setting for the first 3–6 months); once set, older merges can't be undone. A later merge involving either patient must be undone first. | T15 |
| Notifications and audit | Patients aren't notified. Every step (check, register, override, queue read, propose, approve, reject, cancel, undo) is audited, **without names or phone numbers in the audit log**. | T15 |

## 11. Documents

- Only PDF, PNG or JPEG, up to 4 MB, with the file signature checked against the type.
- An approved HTTPS malware scanner must report the file clean; with no scanner, uploads are refused.
- Stored in a private bucket under random names. Downloads use 60-second signed links after an access check.

## 12. Notifications

- Sent only to patients who **opted in** on a **verified** contact (email or mobile), per channel. Opting in or out is recorded as consent.
- Messages never contain clinical details. Templates: appointment confirmed / changed / cancelled, reminders 24 h and 1 h before, payment received, refund processed, record available, prescription updated, prescription withdrawn.
- Reminders are replaced when the appointment changes. Failed sends are retried on a rate limit (HTTP 429); unknown outcomes are not blindly re-sent.
- A website WhatsApp *chat link* is not the WhatsApp Business API. Automated WhatsApp needs approved templates (`HMS_WA_TEMPLATE_MAP`).

## 13. Website content

- Workflow: draft → medical review → approved → published → archived (→ draft).
- Content managers draft and submit; doctors (`cms.review`) approve or return; admins (`cms.publish`) publish and archive. Every step is audited.
- Only published content appears on the website. Hospital contacts come from configuration, never placeholders.

## 14. Audit trail

- Recorded: bookings, cancellations, status changes, payments, refunds, role changes, settings, policy changes, clinical reads and writes, prescription corrections, document access, patient searches.
- The audit log is **append-only**. Nobody, including the database owner through normal statements, can edit or delete entries. Retention purges are a documented owner procedure ([BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md)). (T11)
- No passwords, tokens, card data or search text in logs.

## 15. Callback requests (website)

Name, mobile (E.164), category and consent are required; protected by CAPTCHA and an origin check. Off unless `HMS_CALLBACK_ENABLED=true`. Reception marks requests contacted or closed.

---

## 16. Decision log

| Date | Decision | Decided by | Notes |
|---|---|---|---|
| 24 Nov 2026 | Booking references become random 7-character codes without confusable characters | Engineering (audit) | Migration 019 |
| 24 Nov 2026 | Patient UHIDs stay sequential (`PT-000123`) | Engineering, accepted by owner | Familiar to hospital staff; revisit on request |
| 24 Nov 2026 | Refund estimate shown as 5–7 working days | Engineering, accepted by owner | Change if the hospital's Razorpay terms are faster |
| 24 Nov 2026 | Audit log is append-only; search text never stored | Engineering (audit) | Migrations 019, 020 |
| 25 Nov 2026 | Doctor leave can be recorded while patients are booked; hospital cancellations always refund in full; desk refunds handled by billing | Owner | Migration 021 |
| 25 Nov 2026 | Prescription corrections: issuer-only amendment, 72 h from first issue, patient notified on every amendment, withdrawal needs a second person (another doctor or admin), hidden from the patient while pending | Owner (approved proposal) | Migration 022 |
| 25 Nov 2026 | Duplicate patients: match levels as above (shared mobile alone is not a match); merges approved by an administrator only; first-registered UHID survives, other becomes an alias; ID document type checked before approval (number never stored); date of birth required for online booking | Owner (approved proposal) | Migration 023 |
| 25 Nov 2026 | Merge undo has **no time limit** for the initial stage (3–6 months); a limit can be set later with `merge_undo_days` | Owner | Migration 023 |
| Pending | Nurses recording vitals | Hospital | HMS-021 |
