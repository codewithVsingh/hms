# Roles and permissions

Permissions are enforced inside database functions (`hms_private.staff_permission`) and require an active membership in the branch plus an MFA session (`aal2`). The portal navigation only mirrors them; hiding a menu item is never the control. Source of truth: `hms.role_permissions` (migration 004, extended in later migrations). The matrix below was exported from a database built from migrations 001–019.

## Matrix

| Permission | Meaning | Super admin | Doctor | Receptionist | Billing | Nurse | Content manager |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `appointments.read` | Read branch appointments | ✓ | | ✓ | | | |
| `appointments.assigned.read` | Read own assigned appointments | | ✓ | | | ✓ | |
| `appointments.create` | Create or reschedule appointments | | | ✓ | | | |
| `appointments.checkin` | Check in patients | | | ✓ | | | |
| `patients.register` | Register patients | | | ✓ | | | |
| `patients.demographics.read` | Read branch patient demographics | ✓ | | ✓ | | | |
| `patients.assigned.read` | Read assigned patient demographics | | ✓ | | | | |
| `clinical.assigned.read` | Read assigned clinical records | | ✓ | | | | |
| `clinical.assigned.write` | Write assigned clinical records | | ✓ | | | | |
| `prescriptions.issue` | Issue signed prescriptions | | ✓ | | | | |
| `prescriptions.archive` | Record prescription handover, archive paper copies | | | ✓ | | | |
| `billing.read` | Read branch invoices and payments | ✓ | | | ✓ | | |
| `payments.collect` | Collect offline payments | ✓ | | | ✓ | | |
| `refunds.approve` | Approve refunds | ✓ | | | | | |
| `cms.manage` | Manage website content | ✓ | | | | | ✓ |
| `cms.review` | Medically review proposed content | | ✓ | | | | |
| `cms.publish` | Publish approved content | ✓ | | | | | |
| `settings.manage` | Branch settings, schedules, fees, cancellation policy | ✓ | | | | | |
| `users.manage` | Invite team members | ✓ | | | | | |
| `roles.manage` | Change role assignments | ✓ | | | | | |
| `audit.read` | Read audit events | ✓ | | | | | |

Patients are not a staff role. They act through a verified phone session, and every patient function checks that the record belongs to them.

## Rules worth knowing

- Nobody can change their own roles (`hms_v3_roles`).
- Invitations can grant only receptionist, billing, nurse or content manager. Doctor requires a provisioned doctor profile; super admin is assigned only by an existing super admin.
- Doctors see clinical data only for patients with an active care assignment (created when an appointment is confirmed). Assignments are revoked when the last qualifying appointment is cancelled.
- Super admin intentionally has no clinical permissions. Admins manage the hospital, not medical records.
- Receptionists can record a prescription handover or attach a paper copy, but cannot edit clinical content.

## Doctor unavailability (migration 021)

- Add leave with a reason: super admin, or the doctor for their own schedule.
- See affected bookings and cancel as the hospital (full refund, reason recorded): `appointments.create` (reception) or `settings.manage` (admin). Patient phone numbers are shown only to roles with `patients.demographics.read`.
- Record a refund given at the desk: `payments.collect` (billing). Online refunds still need `refunds.approve` (admin) unless automatic policy refunds are on.

## Prescription corrections (migration 022)

- Amend: only the doctor who issued the prescription, within the amendment window.
- Request withdrawal: the issuing doctor. Confirm or reject: a **different** person, either a doctor in the branch (`prescriptions.issue`) or an administrator (`settings.manage`). Administrators see the reason but not the medicines.
- Version history: clinicians with a care assignment for the patient.
- Mark a paper copy recalled: reception (`prescriptions.archive`).

## Gaps and decisions pending

- Nurse vitals entry (`vitals.write`): HMS-021.
- Separate "hospital owner" vs "branch admin": the system is single-branch today, so super admin covers both.
- A dedicated read-only "auditor" role (`audit.read` without settings) would support compliance reviews without admin rights.
