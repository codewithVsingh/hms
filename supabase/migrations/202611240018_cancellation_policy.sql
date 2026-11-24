BEGIN;
-- Default: no deduction. Configure a reviewed policy before charging cancellation fees.
ALTER TABLE hms.hospital_settings ADD COLUMN cancellation_fee_paise bigint NOT NULL DEFAULT 0 CHECK(cancellation_fee_paise BETWEEN 0 AND 10000000), ADD COLUMN free_cancel_hours integer NOT NULL DEFAULT 24 CHECK(free_cancel_hours BETWEEN 0 AND 720), ADD COLUMN cancel_policy_version integer NOT NULL DEFAULT 1 CHECK(cancel_policy_version>0);
ALTER TABLE hms.appointments ADD COLUMN cancel_fee_paise bigint NOT NULL DEFAULT 0 CHECK(cancel_fee_paise>=0), ADD COLUMN free_cancel_hours integer NOT NULL DEFAULT 24 CHECK(free_cancel_hours BETWEEN 0 AND 720), ADD COLUMN cancel_policy_version integer NOT NULL DEFAULT 0;
CREATE FUNCTION hms_private.snapshot_cancel_policy() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 SELECT cancellation_fee_paise,free_cancel_hours,cancel_policy_version INTO NEW.cancel_fee_paise,NEW.free_cancel_hours,NEW.cancel_policy_version FROM hms.hospital_settings WHERE organization_id=NEW.organization_id AND branch_id=NEW.branch_id;
 IF NOT FOUND THEN NEW.cancel_fee_paise:=0;NEW.free_cancel_hours:=24;NEW.cancel_policy_version:=0; END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER snapshot_cancel_policy BEFORE INSERT ON hms.appointments FOR EACH ROW EXECUTE FUNCTION hms_private.snapshot_cancel_policy();
CREATE TABLE hms.booking_cancellations (
 appointment_id uuid PRIMARY KEY REFERENCES hms.appointments(id), organization_id uuid NOT NULL, branch_id uuid NOT NULL, payment_id uuid REFERENCES hms.payments(id), refund_id uuid UNIQUE REFERENCES hms.refunds(id),
 paid_paise bigint NOT NULL CHECK(paid_paise>=0), deduction_paise bigint NOT NULL CHECK(deduction_paise>=0), refund_paise bigint NOT NULL CHECK(refund_paise>=0), policy_version integer NOT NULL, requested_by uuid NOT NULL REFERENCES auth.users(id), requested_at timestamptz NOT NULL DEFAULT now(),
 CHECK(paid_paise=deduction_paise+refund_paise), CHECK((refund_paise>0)=(refund_id IS NOT NULL)), FOREIGN KEY(organization_id,branch_id,appointment_id) REFERENCES hms.appointments(organization_id,branch_id,id)
);
ALTER TABLE hms.booking_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hms.booking_cancellations FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.hms_v4_policy(p_slug text,p_branch text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('feePaise',hs.cancellation_fee_paise,'freeHours',hs.free_cancel_hours,'version',hs.cancel_policy_version) FROM hms.hospital_settings hs JOIN hms.organizations o ON o.id=hs.organization_id AND o.active JOIN hms.branches b ON b.id=hs.branch_id AND b.active WHERE o.slug=p_slug AND b.code=p_branch;
$$;
CREATE FUNCTION public.hms_v4_policy_set(p_org uuid,p_branch uuid,p_fee bigint,p_hours integer,p_expected integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h hms.hospital_settings%ROWTYPE;
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'settings.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_fee IS NULL OR p_fee NOT BETWEEN 0 AND 10000000 OR p_hours IS NULL OR p_hours NOT BETWEEN 0 AND 720 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 UPDATE hms.hospital_settings SET cancellation_fee_paise=p_fee,free_cancel_hours=p_hours,cancel_policy_version=cancel_policy_version+1 WHERE organization_id=p_org AND branch_id=p_branch AND cancel_policy_version=p_expected RETURNING * INTO h;
 IF NOT FOUND THEN RAISE EXCEPTION 'POLICY_CHANGED'; END IF;
 PERFORM hms_private.v3_audit(p_org,p_branch,'booking.cancel_policy.update','branch',p_branch);
 RETURN jsonb_build_object('feePaise',h.cancellation_fee_paise,'freeHours',h.free_cancel_hours,'version',h.cancel_policy_version);
END;$$;
-- Mandatory acknowledgement of the policy version at booking time. Old booking references stay valid.
CREATE FUNCTION public.hms_v4_book_self(p_slug text,p_branch text,p_slot uuid,p_name text,p_payment text,p_request uuid,p_notice text,p_adult boolean,p_expected_fee bigint,p_policy integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v integer; previous uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 SELECT a.id INTO previous FROM hms.appointments a JOIN hms.organizations o ON o.id=a.organization_id AND o.slug=p_slug JOIN hms.branches b ON b.id=a.branch_id AND b.code=p_branch WHERE a.booking_user_id=auth.uid() AND a.request_id=p_request AND a.source='online';
 IF previous IS NOT NULL THEN RETURN hms_private.booking_view(previous); END IF;
 -- Lock the slot before policy, matching the booking helper's lock ordering.
 PERFORM 1 FROM hms.appointment_slots WHERE id=p_slot FOR UPDATE;
 SELECT h.cancel_policy_version INTO v FROM hms.hospital_settings h JOIN hms.organizations o ON o.id=h.organization_id AND o.slug=p_slug AND o.active JOIN hms.branches b ON b.id=h.branch_id AND b.code=p_branch AND b.active FOR SHARE OF h;
 IF v IS NULL OR v IS DISTINCT FROM p_policy THEN RAISE EXCEPTION 'POLICY_CHANGED'; END IF;
 RETURN public.hms_book_self(p_slug,p_branch,p_slot,p_name,p_payment,p_request,p_notice,p_adult,p_expected_fee);
END;$$;
-- To avoid per-user lock/slot inversion with the old function, acquire the same user lock first.
-- Enforce owner and verified mobile. Reception-created unlinked bookings must be managed by reception.
CREATE FUNCTION hms_private.v4_owner(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM hms.appointments a JOIN hms.patient_owners po ON po.organization_id=a.organization_id AND po.patient_id=a.patient_id AND po.user_id=auth.uid() JOIN auth.users u ON u.id=po.user_id AND u.phone_confirmed_at IS NOT NULL AND nullif(u.phone,'') IS NOT NULL JOIN hms.organizations o ON o.id=a.organization_id AND o.active WHERE a.id=p_id AND a.booking_user_id=auth.uid() AND a.source='online');
$$;
CREATE FUNCTION public.hms_v4_find_booking(p_slug text,p_branch text,p_reference text,p_identity text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE aid uuid;
BEGIN
 IF auth.uid() IS NULL OR length(trim(p_reference)) NOT BETWEEN 4 AND 40 OR length(trim(p_identity)) NOT BETWEEN 2 AND 100 THEN RETURN NULL; END IF;
 SELECT a.id INTO aid FROM hms.appointments a JOIN hms.organizations o ON o.id=a.organization_id AND o.slug=p_slug JOIN hms.branches b ON b.id=a.branch_id AND b.code=p_branch JOIN hms.patients p ON p.id=a.patient_id WHERE upper(a.reference)=upper(trim(p_reference)) AND (upper(p.mrn)=upper(trim(p_identity)) OR lower(trim(p.full_name))=lower(trim(p_identity))) AND hms_private.v4_owner(a.id);
 IF aid IS NULL THEN RETURN NULL; END IF;
 RETURN hms_private.booking_view(aid);
END;$$;
CREATE FUNCTION public.hms_v4_cancel_quote(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; i hms.invoices%ROWTYPE; s hms.appointment_slots%ROWTYPE; p hms.payments%ROWTYPE; c hms.booking_cancellations%ROWTYPE; paid bigint:=0; fee bigint:=0; n integer; state text;
BEGIN
 IF NOT hms_private.v4_owner(p_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO a FROM hms.appointments WHERE id=p_id;
 SELECT * INTO c FROM hms.booking_cancellations WHERE appointment_id=p_id;
 IF FOUND THEN
  SELECT status INTO state FROM hms.refunds WHERE id=c.refund_id;
  RETURN jsonb_build_object('eligible',false,'cancelled',true,'paidPaise',c.paid_paise,'deductionPaise',c.deduction_paise,'refundPaise',c.refund_paise,'policyVersion',c.policy_version,'refundStatus',coalesce(state,'not_required'),'refundId',c.refund_id);
 END IF;
 SELECT * INTO i FROM hms.invoices WHERE appointment_id=p_id;
 SELECT * INTO s FROM hms.appointment_slots WHERE id=a.slot_id;
 IF a.status NOT IN ('held','confirmed') OR s.starts_at<=now() OR (a.status='held' AND a.hold_expires_at<=now()) THEN RETURN jsonb_build_object('eligible',false,'reason','invalid_status'); END IF;
 SELECT count(*) INTO n FROM hms.payments WHERE invoice_id=i.id AND status IN ('captured','pending','reconciliation_required','refunded','partially_refunded');
 IF n=0 AND i.order_claim IS NULL AND (i.status='issued' OR (i.status='settled' AND i.total_paise=0)) THEN NULL;
 ELSIF n=1 AND a.status='confirmed' AND i.status='settled' THEN
  SELECT * INTO p FROM hms.payments WHERE invoice_id=i.id AND status='captured' AND method='razorpay' AND amount_paise=i.total_paise;
  IF p.id IS NULL OR EXISTS(SELECT 1 FROM hms.refunds WHERE payment_id=p.id) OR EXISTS(SELECT 1 FROM hms.payment_orders WHERE invoice_id=i.id AND status='reconciliation_required') THEN RETURN jsonb_build_object('eligible',false,'reason','payment_review'); END IF;
  paid:=p.amount_paise;
 ELSE RETURN jsonb_build_object('eligible',false,'reason','payment_review'); END IF;
 IF s.starts_at-now()<make_interval(hours=>a.free_cancel_hours) THEN fee:=least(paid,a.cancel_fee_paise); END IF;
 RETURN jsonb_build_object('eligible',true,'cancelled',false,'paidPaise',paid,'deductionPaise',fee,'refundPaise',paid-fee,'policyVersion',a.cancel_policy_version,'freeHours',a.free_cancel_hours,'feePaise',a.cancel_fee_paise,'startsAt',s.starts_at,'slotId',s.id);
END;$$;
CREATE FUNCTION public.hms_v4_cancel(p_id uuid,p_paid bigint,p_deduction bigint,p_refund bigint,p_policy integer,p_slot uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; i hms.invoices%ROWTYPE; p hms.payments%ROWTYPE; q jsonb; rid uuid; old text; initial_slot uuid;
BEGIN
 IF NOT hms_private.v4_owner(p_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT slot_id INTO initial_slot FROM hms.appointments WHERE id=p_id;
 PERFORM 1 FROM hms.appointment_slots WHERE id=initial_slot FOR UPDATE;
 SELECT * INTO a FROM hms.appointments WHERE id=p_id FOR UPDATE;
 IF a.slot_id<>initial_slot THEN RAISE EXCEPTION 'QUOTE_CHANGED'; END IF;
 SELECT * INTO i FROM hms.invoices WHERE appointment_id=a.id FOR UPDATE;
 PERFORM 1 FROM hms.payments WHERE invoice_id=i.id FOR UPDATE;
 q:=public.hms_v4_cancel_quote(p_id);
 IF (q->>'cancelled')::boolean IS TRUE THEN RETURN q; END IF;
 IF (q->>'eligible')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'NOT_CANCELLABLE'; END IF;
 IF (q->>'paidPaise')::bigint IS DISTINCT FROM p_paid OR (q->>'deductionPaise')::bigint IS DISTINCT FROM p_deduction OR (q->>'refundPaise')::bigint IS DISTINCT FROM p_refund OR (q->>'policyVersion')::integer IS DISTINCT FROM p_policy OR a.slot_id IS DISTINCT FROM p_slot THEN RAISE EXCEPTION 'QUOTE_CHANGED'; END IF;
 IF p_paid>0 THEN SELECT * INTO p FROM hms.payments WHERE invoice_id=i.id AND status='captured' AND method='razorpay'; END IF;
 IF p_refund>0 THEN
  rid:=gen_random_uuid();
  INSERT INTO hms.refunds(id,organization_id,payment_id,amount_paise,status,reason_code,idempotency_key) VALUES(rid,a.organization_id,p.id,p_refund,'requested','cancelled_visit',rid::text);
 END IF;
 INSERT INTO hms.booking_cancellations VALUES(a.id,a.organization_id,a.branch_id,p.id,rid,p_paid,p_deduction,p_refund,p_policy,auth.uid(),now());
 old:=a.status;
 UPDATE hms.appointments SET status='cancelled',updated_at=now() WHERE id=a.id;
 IF p_paid=0 THEN UPDATE hms.invoices SET status='void' WHERE id=i.id; END IF;
 UPDATE hms.care_assignments ca SET revoked_at=now() WHERE ca.organization_id=a.organization_id AND ca.branch_id=a.branch_id AND ca.patient_id=a.patient_id AND ca.doctor_id=a.doctor_id AND ca.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM hms.appointments a2 WHERE a2.id<>a.id AND a2.organization_id=a.organization_id AND a2.branch_id=a.branch_id AND a2.patient_id=a.patient_id AND a2.doctor_id=a.doctor_id AND a2.status IN ('confirmed','checked_in','in_consultation','completed'));
 INSERT INTO hms.appointment_status_history(organization_id,appointment_id,from_status,to_status,actor_user_id,reason_code) VALUES(a.organization_id,a.id,old,'cancelled',auth.uid(),'patient_policy');
 PERFORM hms_private.v3_audit(a.organization_id,a.branch_id,'appointment.self_cancel.policy','appointment',a.id);
 RETURN public.hms_v4_cancel_quote(p_id);
END;$$;
-- Claim a persisted refund exactly once; unknown provider outcome stays in processing for review.
CREATE FUNCTION public.hms_v4_claim_requested_refund(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r hms.refunds%ROWTYPE; p hms.payments%ROWTYPE;
BEGIN
 UPDATE hms.refunds SET status='processing' WHERE id=p_id AND status='requested' AND EXISTS(SELECT 1 FROM hms.booking_cancellations c WHERE c.refund_id=p_id) RETURNING * INTO r;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO p FROM hms.payments WHERE id=r.payment_id;
 RETURN jsonb_build_object('refundId',r.id,'paymentId',p.provider_payment_id,'amount',r.amount_paise,'receipt','RF-'||replace(r.id::text,'-',''));
END;$$;
CREATE FUNCTION public.hms_v4_requested_refunds(p_slug text,p_branch text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(q.id),'[]'::jsonb) FROM (SELECT r.id FROM hms.refunds r JOIN hms.booking_cancellations c ON c.refund_id=r.id JOIN hms.organizations o ON o.id=c.organization_id JOIN hms.branches b ON b.id=c.branch_id WHERE o.slug=p_slug AND b.code=p_branch AND r.status='requested' ORDER BY c.requested_at LIMIT 5) q;
$$;
-- Existing admin workflow can approve an already requested policy refund, but cannot replace its amount with a full refund.
CREATE OR REPLACE FUNCTION public.hms_refund_claim(p_payment uuid,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p hms.payments%ROWTYPE; i hms.invoices%ROWTYPE; a hms.appointments%ROWTYPE; r hms.refunds%ROWTYPE; rid uuid; c hms.booking_cancellations%ROWTYPE;
BEGIN
 SELECT * INTO p FROM hms.payments WHERE id=p_payment;
 IF NOT FOUND OR p.method<>'razorpay' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO i FROM hms.invoices WHERE id=p.invoice_id; SELECT * INTO a FROM hms.appointments WHERE id=i.appointment_id;
 IF NOT hms_private.staff_permission(a.organization_id,a.branch_id,'refunds.approve') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_reason NOT IN ('cancelled_visit','late_capture','duplicate_capture','other_review') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 PERFORM 1 FROM hms.appointment_slots WHERE id=a.slot_id FOR UPDATE; SELECT * INTO a FROM hms.appointments WHERE id=a.id FOR UPDATE;
 PERFORM 1 FROM hms.invoices WHERE id=i.id FOR UPDATE; SELECT * INTO p FROM hms.payments WHERE id=p.id FOR UPDATE;
 SELECT * INTO r FROM hms.refunds WHERE payment_id=p.id FOR UPDATE;
 SELECT * INTO c FROM hms.booking_cancellations WHERE appointment_id=a.id AND payment_id=p.id;
 IF r.id IS NOT NULL THEN
  IF r.status='requested' AND c.refund_id=r.id THEN UPDATE hms.refunds SET status='processing',approved_by=auth.uid() WHERE id=r.id; rid:=r.id;
  ELSE RAISE EXCEPTION 'REFUND_REVIEW'; END IF;
 ELSIF c.appointment_id IS NOT NULL THEN RAISE EXCEPTION 'NOT_REFUNDABLE';
 ELSE
  IF NOT((a.status IN ('cancelled','expired') AND p.status='captured') OR p.status='reconciliation_required') THEN RAISE EXCEPTION 'NOT_REFUNDABLE'; END IF;
  rid:=gen_random_uuid(); INSERT INTO hms.refunds(id,organization_id,payment_id,amount_paise,status,reason_code,approved_by,idempotency_key) VALUES(rid,p.organization_id,p.id,p.amount_paise,'processing',p_reason,auth.uid(),rid::text);
 END IF;
 PERFORM hms_private.v3_audit(a.organization_id,a.branch_id,'refund.approve','refund',rid);
 RETURN jsonb_build_object('refundId',rid,'paymentId',p.provider_payment_id,'amount',coalesce(r.amount_paise,p.amount_paise),'receipt','RF-'||replace(rid::text,'-',''));
END;$$;
-- Preserve gross collection and refund ledger; partial refund leaves settled invoice as historical original.
CREATE OR REPLACE FUNCTION public.hms_apply_refund(p_id uuid,p_provider text,p_payment text,p_amount bigint,p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r hms.refunds%ROWTYPE; p hms.payments%ROWTYPE; i hms.invoices%ROWTYPE; a hms.appointments%ROWTYPE;
BEGIN
 SELECT * INTO r FROM hms.refunds WHERE id=p_id; SELECT * INTO p FROM hms.payments WHERE id=r.payment_id; SELECT * INTO i FROM hms.invoices WHERE id=p.invoice_id; SELECT * INTO a FROM hms.appointments WHERE id=i.appointment_id;
 IF a.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM 1 FROM hms.appointment_slots WHERE id=a.slot_id FOR UPDATE; SELECT * INTO a FROM hms.appointments WHERE id=a.id FOR UPDATE;
 SELECT * INTO i FROM hms.invoices WHERE id=i.id FOR UPDATE; SELECT * INTO p FROM hms.payments WHERE id=p.id FOR UPDATE; SELECT * INTO r FROM hms.refunds WHERE id=p_id FOR UPDATE;
 IF p.provider_payment_id IS DISTINCT FROM p_payment OR r.amount_paise IS DISTINCT FROM p_amount OR p_amount<=0 OR p_amount>p.amount_paise OR p_provider !~ '^rfnd_[A-Za-z0-9]+$' OR p_status NOT IN ('pending','processed','failed') OR (r.provider_refund_id IS NOT NULL AND r.provider_refund_id<>p_provider) THEN RAISE EXCEPTION 'REFUND_MISMATCH'; END IF;
 IF p_amount<p.amount_paise AND NOT EXISTS(SELECT 1 FROM hms.booking_cancellations c WHERE c.refund_id=r.id AND c.payment_id=p.id AND c.refund_paise=p_amount AND c.paid_paise=p.amount_paise) THEN RAISE EXCEPTION 'REFUND_MISMATCH'; END IF;
 IF r.status='processed' THEN RETURN; END IF;
 UPDATE hms.refunds SET provider_refund_id=p_provider,status=CASE WHEN p_status='pending' THEN 'processing' ELSE p_status END WHERE id=r.id;
 IF p_status='processed' THEN
  UPDATE hms.payments SET status=CASE WHEN p_amount=p.amount_paise THEN 'refunded' ELSE 'partially_refunded' END WHERE id=p.id;
  IF a.status IN ('cancelled','expired') AND NOT EXISTS(SELECT 1 FROM hms.payments p2 WHERE p2.invoice_id=i.id AND p2.status IN ('captured','reconciliation_required','pending','partially_refunded')) THEN UPDATE hms.invoices SET status='void' WHERE id=i.id; END IF;
  IF p.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hms.payments p2 WHERE p2.order_id=p.order_id AND p2.status='reconciliation_required') THEN UPDATE hms.payment_orders SET status=CASE WHEN EXISTS(SELECT 1 FROM hms.payments p2 WHERE p2.order_id=p.order_id AND p2.status IN ('captured','partially_refunded')) THEN 'paid' ELSE 'expired' END WHERE id=p.order_id; END IF;
 END IF;
 INSERT INTO hms.audit_logs(organization_id,branch_id,action,resource_type,resource_id,result) VALUES(a.organization_id,a.branch_id,'refund.'||p_status,'refund',r.id,'success');
END;$$;
CREATE OR REPLACE FUNCTION public.hms_refund_candidates(p_org uuid,p_branch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'refunds.approve') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (SELECT p.id,p.provider_payment_id,p.amount_paise,p.status AS payment_status,a.reference,a.status AS appointment_status,r.id AS refund_id,r.provider_refund_id,r.status AS refund_status,r.amount_paise AS refund_amount_paise,c.deduction_paise AS cancellation_deduction_paise FROM hms.payments p JOIN hms.invoices i ON i.id=p.invoice_id JOIN hms.appointments a ON a.id=i.appointment_id LEFT JOIN hms.refunds r ON r.payment_id=p.id LEFT JOIN hms.booking_cancellations c ON c.appointment_id=a.id AND c.payment_id=p.id WHERE p.organization_id=p_org AND a.branch_id=p_branch AND p.method='razorpay' AND (c.appointment_id IS NULL OR c.refund_id IS NOT NULL) AND ((a.status IN ('cancelled','expired') AND p.status='captured') OR p.status='reconciliation_required' OR r.id IS NOT NULL) ORDER BY p.created_at DESC LIMIT 100) q);
END; $$;

CREATE OR REPLACE FUNCTION public.hms_v3_reconciliation_candidates(p_slug text,p_branch text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('orders',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT po.provider_order_id "orderId" FROM hms.payment_orders po JOIN hms.invoices i ON i.id=po.invoice_id JOIN hms.branches b ON b.id=i.branch_id JOIN hms.organizations o ON o.id=i.organization_id WHERE o.slug=p_slug AND b.code=p_branch AND po.status IN ('created','reconciliation_required') AND po.created_at>now()-interval '7 days' AND NOT EXISTS(SELECT 1 FROM hms.payments p WHERE p.order_id=po.id AND p.status IN ('captured','reconciliation_required','refunded')) ORDER BY po.created_at DESC LIMIT 10) q),'[]'::jsonb),
 'refunds',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT r.id "refundId",p.provider_payment_id "paymentId",r.amount_paise amount,r.provider_refund_id "providerRefundId",'RF-'||replace(r.id::text,'-','') receipt FROM hms.refunds r JOIN hms.payments p ON p.id=r.payment_id JOIN hms.invoices i ON i.id=p.invoice_id JOIN hms.branches b ON b.id=i.branch_id JOIN hms.organizations o ON o.id=i.organization_id WHERE o.slug=p_slug AND b.code=p_branch AND p.method='razorpay' AND r.status='processing' ORDER BY r.created_at DESC LIMIT 10) q),'[]'::jsonb));
$$;

-- Privileges: previous self-booking RPC must not bypass policy acknowledgement.
REVOKE EXECUTE ON FUNCTION public.hms_book_self(text,text,uuid,text,text,uuid,text,boolean,bigint) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.hms_cancel_self(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hms_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hms_v4_policy(text,text),public.hms_v4_policy_set(uuid,uuid,bigint,integer,integer),public.hms_v4_book_self(text,text,uuid,text,text,uuid,text,boolean,bigint,integer),public.hms_v4_find_booking(text,text,text,text),public.hms_v4_cancel_quote(uuid),public.hms_v4_cancel(uuid,bigint,bigint,bigint,integer,uuid),public.hms_v4_claim_requested_refund(uuid),public.hms_v4_requested_refunds(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hms_v4_policy(text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hms_v4_policy_set(uuid,uuid,bigint,integer,integer),public.hms_v4_book_self(text,text,uuid,text,text,uuid,text,boolean,bigint,integer),public.hms_v4_find_booking(text,text,text,text),public.hms_v4_cancel_quote(uuid),public.hms_v4_cancel(uuid,bigint,bigint,bigint,integer,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hms_v4_claim_requested_refund(uuid),public.hms_v4_requested_refunds(text,text) TO service_role;
COMMIT;
