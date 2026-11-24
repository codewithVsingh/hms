# Future roadmap

The project is OPD-first. Items are ordered by value to daily OPD operations, safety and reliability. Larger modules are listed separately and should only start once the OPD core is live and stable.

## Next (launch-critical, see PRODUCTION_READINESS.md)

Doctor-unavailability workflow · prescription amendments · duplicate patient detection and merge · edge rate limiting · notification providers · Hindi completion.

## Soon after launch (OPD improvements)

- Waiting list that offers freed slots to waiting patients
- Follow-up booking from the consultation screen (doctor suggests a date; reception or the patient books)
- Daily cash close per collector; discounts with approval
- Doctor-wise and department-wise reports; occupancy and no-show trends
- Patient feedback after completed visits (no clinical content)
- In-app notification inbox for patients and staff
- Nurse vitals entry; a read-only auditor role
- Hospital announcements on the website and portal, managed in the CMS
- CMS-managed gallery
- Request correlation IDs across API → DB audit entries; structured logging with PII scrubbing; error monitoring
- Nonce-based strict CSP

## Future modules (separate scoping and approval)

| Module | Notes |
|---|---|
| Laboratory orders and results | Needs LIS integration and result-release rules |
| Pharmacy and inventory | Medicine catalogue, stock, dispensing |
| IPD (admissions, beds, nursing) | Large scope; different workflows |
| Insurance / TPA claims | Payer integrations |
| Teleconsultation | Telemedicine practice guidelines; video provider |
| ABDM (ABHA IDs, health records exchange) | Government integration and certification |
| Multi-branch UI | The schema already supports it |
