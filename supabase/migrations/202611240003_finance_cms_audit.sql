BEGIN;
CREATE TABLE hms.invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, branch_id uuid NOT NULL, appointment_id uuid NOT NULL,
 invoice_number text NOT NULL, currency char(3) NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
 total_paise bigint NOT NULL CHECK(total_paise>=0), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','void','settled')),
 issued_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id), UNIQUE(organization_id,invoice_number),
 FOREIGN KEY(organization_id,branch_id,appointment_id) REFERENCES hms.appointments(organization_id,branch_id,id)
);
CREATE TABLE hms.invoice_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, invoice_id uuid NOT NULL,
 description text NOT NULL, quantity integer NOT NULL CHECK(quantity>0), unit_paise bigint NOT NULL CHECK(unit_paise>=0),
 total_paise bigint GENERATED ALWAYS AS (quantity::bigint*unit_paise) STORED,
 FOREIGN KEY(organization_id,invoice_id) REFERENCES hms.invoices(organization_id,id)
);
CREATE TABLE hms.payment_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, invoice_id uuid NOT NULL,
 provider text NOT NULL DEFAULT 'razorpay' CHECK(provider='razorpay'), provider_order_id text NOT NULL UNIQUE,
 amount_paise bigint NOT NULL CHECK(amount_paise>0), currency char(3) NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
 status text NOT NULL DEFAULT 'created' CHECK(status IN ('created','paid','failed','expired','reconciliation_required')),
 idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id),
 UNIQUE(organization_id,idempotency_key), UNIQUE(organization_id,invoice_id,id),
 FOREIGN KEY(organization_id,invoice_id) REFERENCES hms.invoices(organization_id,id)
);
CREATE TABLE hms.payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, invoice_id uuid NOT NULL, order_id uuid,
 method text NOT NULL CHECK(method IN ('razorpay','cash','upi_offline','card_offline','bank_transfer')),
 provider_payment_id text UNIQUE, amount_paise bigint NOT NULL CHECK(amount_paise>0), currency char(3) NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
 status text NOT NULL CHECK(status IN ('pending','captured','failed','partially_refunded','refunded','reconciliation_required')),
 captured_at timestamptz, received_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id),
 CHECK(method<>'razorpay' OR (order_id IS NOT NULL AND provider_payment_id IS NOT NULL)),
 FOREIGN KEY(organization_id,invoice_id) REFERENCES hms.invoices(organization_id,id),
 FOREIGN KEY(organization_id,invoice_id,order_id) REFERENCES hms.payment_orders(organization_id,invoice_id,id)
);
CREATE TABLE hms.refunds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, payment_id uuid NOT NULL, provider_refund_id text UNIQUE,
 amount_paise bigint NOT NULL CHECK(amount_paise>0), status text NOT NULL CHECK(status IN ('requested','approved','processing','processed','failed','rejected')),
 reason_code text NOT NULL, approved_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 idempotency_key text NOT NULL, UNIQUE(organization_id,idempotency_key), FOREIGN KEY(organization_id,payment_id) REFERENCES hms.payments(organization_id,id)
);
CREATE TABLE hms.webhook_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL CHECK(provider='razorpay'), provider_event_id text NOT NULL,
 event_type text NOT NULL, payload_digest text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
 state text NOT NULL DEFAULT 'received' CHECK(state IN ('received','processed','failed','needs_review')),
 UNIQUE(provider,provider_event_id)
);
CREATE INDEX payments_invoice_idx ON hms.payments(organization_id,invoice_id);
CREATE INDEX refunds_payment_idx ON hms.refunds(organization_id,payment_id);
-- Aggregate invoice/payment/refund constraints must be enforced in locked live service transactions.
-- No card numbers, CVV, full webhook payloads or gateway secrets are stored in this schema.
CREATE TABLE hms.content_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES hms.organizations(id),
 kind text NOT NULL CHECK(kind IN ('page','service','article','faq','landing')), slug text NOT NULL,
 title text NOT NULL, summary text, body text, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','medical_review','approved','published','archived')),
 reviewed_by uuid REFERENCES auth.users(id), reviewed_at timestamptz, published_at timestamptz, seo_title text, seo_description text,
 canonical_path text, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,kind,slug),
 CHECK(status<>'published' OR (published_at IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL))
);
CREATE TABLE hms.notification_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, appointment_id uuid NOT NULL,
 channel text NOT NULL CHECK(channel IN ('email','sms','whatsapp')), template_key text NOT NULL, idempotency_key text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','sent','failed','dead_letter')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,idempotency_key), FOREIGN KEY(organization_id,appointment_id) REFERENCES hms.appointments(organization_id,id)
);
CREATE INDEX notification_jobs_due ON hms.notification_jobs(next_attempt_at) WHERE state='queued';
CREATE TABLE hms.audit_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id uuid NOT NULL REFERENCES hms.organizations(id), branch_id uuid,
 actor_user_id uuid REFERENCES auth.users(id), action text NOT NULL, resource_type text NOT NULL, resource_id uuid,
 request_id text, result text NOT NULL CHECK(result IN ('success','denied','failed')), occurred_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,branch_id) REFERENCES hms.branches(organization_id,id)
);
CREATE INDEX audit_org_time_idx ON hms.audit_logs(organization_id,occurred_at DESC);
CREATE TABLE hms.consent_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, patient_id uuid NOT NULL,
 purpose text NOT NULL, notice_version text NOT NULL, status text NOT NULL CHECK(status IN ('granted','withdrawn','declined')),
 recorded_by uuid REFERENCES auth.users(id), recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,patient_id) REFERENCES hms.patients(organization_id,id)
);
CREATE TABLE hms.hospital_settings (
 organization_id uuid NOT NULL REFERENCES hms.organizations(id), branch_id uuid NOT NULL,
 booking_enabled boolean NOT NULL DEFAULT false, online_payment_enabled boolean NOT NULL DEFAULT false,
 default_slot_minutes integer NOT NULL DEFAULT 30 CHECK(default_slot_minutes BETWEEN 5 AND 180),
 PRIMARY KEY(organization_id,branch_id), FOREIGN KEY(organization_id,branch_id) REFERENCES hms.branches(organization_id,id)
);
COMMIT;
