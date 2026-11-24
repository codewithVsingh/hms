# API map

All portal endpoints use `/api/v1/`. GET public catalog/slots returns minimal published information. Other patient endpoints require a verified session and ownership; staff operations additionally require active branch membership, permission checks and AAL2. POST is same-origin except Razorpay webhook, which is signature-verified. SQL functions are the transaction and final authorization boundary. Browser roles cannot directly read private tables.

| Method | Path | Purpose |
|---|---|---|
| GET | catalog, slots | Published doctors, fee and available times |
| GET | auth/session | Session/phone verification state |
| POST | auth/otp, auth/verify-otp | Supabase SMS sign-in |
| POST | auth/login, auth/mfa, auth/mfa-verify, auth/logout | Staff sign-in and TOTP |
| GET | bookings | Own booking history |
| POST | bookings/create, bookings/cancel | Reserve/confirm or cancel eligible unpaid visit |
| POST | payments/order, payments/verify, payments/recover | Server-priced order, captured payment verification and recovery |
| POST | payments/webhook | Signed payment events |
| GET | staff/context, staff/appointments, staff/patients, staff/slots | Role/branch-scoped views |
| POST | staff/register, staff/book, staff/status, staff/cancel, staff/collect | Patient registration, reception booking, queue transitions, cancellation and offline payments |
| GET/POST | staff/clinical | Assigned consultation draft read/versioned write |
| GET | staff/team, staff/audit, staff/admin-config | Team, audit and settings |
| POST | staff/settings, staff/doctor-settings, staff/schedule/add, staff/schedule/disable, staff/generate | Admin configuration and slot generation |
| GET | staff/content | Authorized content list |
| POST | staff/content/save, staff/content/transition | Drafting, review and publish |
| GET | staff/refunds | Eligible full-refund/reconciliation list |
| POST | staff/refunds/create, staff/refunds/check | Explicit admin approval and provider refund reconciliation |

Private RPCs with server-only settlement permissions: `hms_claim_order`, `hms_attach_order`, `hms_lookup_order`, `hms_capture_payment`, `hms_apply_refund`. Public website RPCs: `hms_catalog`, `hms_available_slots`, `hms_public_content`. See migration files for exact argument types, grants and domain invariants. No automatic webhook refund handling is implemented.


## Health check

`GET /api/health` (portal). Without credentials it returns only `{"status":"ok"|"degraded"}` (HTTP 200/503) for uptime monitors. With `Authorization: Bearer <CRON_SECRET>` it adds the mode (demo/live), payment mode, which configuration groups are present (never values) and a database round trip. Responses are `no-store`.


## Doctor unavailability (v2)

| Method | Path | Purpose |
|---|---|---|
| POST | `leaves` | Record leave `{doctorId, start, end, reason}`; returns `{leaveId, affected}`. No longer refused when bookings exist. |
| GET | `leaves/affected` | Live bookings overlapping current/future leave (reception/admin) |
| POST | `appointments/hospital-cancel` | `{id, reason}`: hospital cancellation, full refund (online → admin approval; desk → desk refunds) |
| GET | `refunds/desk` | Desk refunds waiting to be handed back (billing) |
| POST | `refunds/desk` | `{id, method}`: record a desk refund as given |
