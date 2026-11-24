BEGIN;
-- Full refunds only. Partial refunds require a later ledger workflow. One claim per original payment.
CREATE UNIQUE INDEX full_refund_one_per_payment ON hms.refunds(organization_id,payment_id);
CREATE FUNCTION public.hms_staff_cancel(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; i hms.invoices%ROWTYPE; old text;
BEGIN
 SELECT * INTO a FROM hms.appointments WHERE id=p_id;
 IF NOT FOUND OR NOT(hms_private.staff_permission(a.organization_id,a.branch_id,'appointments.create') OR hms_private.staff_permission(a.organization_id,a.branch_id,'refunds.approve')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM 1 FROM hms.appointment_slots WHERE id=a.slot_id FOR UPDATE;
 SELECT * INTO a FROM hms.appointments WHERE id=p_id FOR UPDATE; old:=a.status;
 SELECT * INTO i FROM hms.invoices WHERE appointment_id=a.id FOR UPDATE;
 IF old='cancelled' THEN RETURN; END IF;
 IF old NOT IN ('held','confirmed') OR NOT EXISTS(SELECT 1 FROM hms.appointment_slots WHERE id=a.slot_id AND starts_at>now()) THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
 UPDATE hms.appointments SET status='cancelled',updated_at=now() WHERE id=a.id;
 IF i.order_claim IS NULL AND i.status='issued' THEN UPDATE hms.invoices SET status='void' WHERE id=i.id; END IF;
 UPDATE hms.care_assignments ca SET revoked_at=now() WHERE ca.organization_id=a.organization_id AND ca.branch_id=a.branch_id AND ca.patient_id=a.patient_id AND ca.doctor_id=a.doctor_id AND ca.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM hms.appointments a2 WHERE a2.id<>a.id AND a2.organization_id=a.organization_id AND a2.branch_id=a.branch_id AND a2.patient_id=a.patient_id AND a2.doctor_id=a.doctor_id AND a2.status IN ('confirmed','checked_in','in_consultation','completed'));
 INSERT INTO hms.appointment_status_history(organization_id,appointment_id,from_status,to_status,actor_user_id) VALUES(a.organization_id,a.id,old,'cancelled',auth.uid());
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(a.organization_id,a.branch_id,auth.uid(),'appointment.staff_cancel','appointment',a.id,'success');
END; $$;
CREATE FUNCTION public.hms_refund_candidates(p_org uuid,p_branch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT hms_private.staff_permission(p_org,p_branch,'refunds.approve') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (SELECT p.id,p.provider_payment_id,p.amount_paise,p.status AS payment_status,a.reference,a.status AS appointment_status,r.id AS refund_id,r.provider_refund_id,r.status AS refund_status FROM hms.payments p JOIN hms.invoices i ON i.id=p.invoice_id JOIN hms.appointments a ON a.id=i.appointment_id LEFT JOIN hms.refunds r ON r.payment_id=p.id WHERE p.organization_id=p_org AND a.branch_id=p_branch AND p.method='razorpay' AND ((a.status IN ('cancelled','expired') AND p.status='captured') OR p.status='reconciliation_required' OR r.id IS NOT NULL) ORDER BY p.created_at DESC LIMIT 100) q);
END; $$;
CREATE FUNCTION public.hms_refund_claim(p_payment uuid,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p hms.payments%ROWTYPE; i hms.invoices%ROWTYPE; a hms.appointments%ROWTYPE; r hms.refunds%ROWTYPE; rid uuid;
BEGIN
 SELECT * INTO p FROM hms.payments WHERE id=p_payment;
 IF NOT FOUND OR p.method<>'razorpay' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO i FROM hms.invoices WHERE id=p.invoice_id;
 SELECT * INTO a FROM hms.appointments WHERE id=i.appointment_id;
 IF NOT hms_private.staff_permission(a.organization_id,a.branch_id,'refunds.approve') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_reason NOT IN ('cancelled_visit','late_capture','duplicate_capture','other_review') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 PERFORM 1 FROM hms.appointment_slots WHERE id=a.slot_id FOR UPDATE;
 SELECT * INTO a FROM hms.appointments WHERE id=a.id FOR UPDATE;
 PERFORM 1 FROM hms.invoices WHERE id=i.id FOR UPDATE;
 SELECT * INTO p FROM hms.payments WHERE id=p.id FOR UPDATE;
 SELECT * INTO r FROM hms.refunds WHERE payment_id=p.id;
 IF r.id IS NOT NULL THEN RAISE EXCEPTION 'REFUND_REVIEW'; END IF;
 IF NOT((a.status IN ('cancelled','expired') AND p.status='captured') OR p.status='reconciliation_required') THEN RAISE EXCEPTION 'NOT_REFUNDABLE'; END IF;
 rid:=gen_random_uuid();
 INSERT INTO hms.refunds(id,organization_id,payment_id,amount_paise,status,reason_code,approved_by,idempotency_key) VALUES(rid,p.organization_id,p.id,p.amount_paise,'processing',p_reason,auth.uid(),rid::text);
 INSERT INTO hms.audit_logs(organization_id,branch_id,actor_user_id,action,resource_type,resource_id,result) VALUES(a.organization_id,a.branch_id,auth.uid(),'refund.approve','refund',rid,'success');
 RETURN jsonb_build_object('refundId',rid,'paymentId',p.provider_payment_id,'amount',p.amount_paise,'receipt','RF-'||replace(rid::text,'-',''));
END; $$;
CREATE FUNCTION public.hms_refund_access(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r hms.refunds%ROWTYPE; p hms.payments%ROWTYPE; i hms.invoices%ROWTYPE;
BEGIN
 SELECT * INTO r FROM hms.refunds WHERE id=p_id;
 SELECT * INTO p FROM hms.payments WHERE id=r.payment_id;
 SELECT * INTO i FROM hms.invoices WHERE id=p.invoice_id;
 IF i.id IS NULL OR NOT hms_private.staff_permission(i.organization_id,i.branch_id,'refunds.approve') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN jsonb_build_object('refundId',r.id,'paymentId',p.provider_payment_id,'amount',r.amount_paise,'providerRefundId',r.provider_refund_id,'receipt','RF-'||replace(r.id::text,'-',''));
END; $$;
CREATE FUNCTION public.hms_apply_refund(p_id uuid,p_provider text,p_payment text,p_amount bigint,p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r hms.refunds%ROWTYPE; p hms.payments%ROWTYPE; i hms.invoices%ROWTYPE; a hms.appointments%ROWTYPE;
BEGIN
 SELECT * INTO r FROM hms.refunds WHERE id=p_id;
 SELECT * INTO p FROM hms.payments WHERE id=r.payment_id;
 SELECT * INTO i FROM hms.invoices WHERE id=p.invoice_id;
 SELECT * INTO a FROM hms.appointments WHERE id=i.appointment_id;
 IF a.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM 1 FROM hms.appointment_slots WHERE id=a.slot_id FOR UPDATE;
 SELECT * INTO a FROM hms.appointments WHERE id=a.id FOR UPDATE;
 SELECT * INTO i FROM hms.invoices WHERE id=i.id FOR UPDATE;
 SELECT * INTO p FROM hms.payments WHERE id=p.id FOR UPDATE;
 SELECT * INTO r FROM hms.refunds WHERE id=p_id FOR UPDATE;
 IF p.provider_payment_id<>p_payment OR r.amount_paise<>p_amount OR p_amount<>p.amount_paise OR p_provider !~ '^rfnd_[A-Za-z0-9]+$' OR p_status NOT IN ('pending','processed','failed') OR (r.provider_refund_id IS NOT NULL AND r.provider_refund_id<>p_provider) THEN RAISE EXCEPTION 'REFUND_MISMATCH'; END IF;
 IF r.status='processed' THEN RETURN; END IF;
 UPDATE hms.refunds SET provider_refund_id=p_provider,status=CASE WHEN p_status='pending' THEN 'processing' ELSE p_status END WHERE id=r.id;
 IF p_status='processed' THEN
 UPDATE hms.payments SET status='refunded' WHERE id=p.id;
 IF a.status IN ('cancelled','expired') AND NOT EXISTS(SELECT 1 FROM hms.payments p2 WHERE p2.invoice_id=i.id AND p2.status IN ('captured','reconciliation_required','pending','partially_refunded')) THEN UPDATE hms.invoices SET status='void' WHERE id=i.id; END IF;
 IF p.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hms.payments p2 WHERE p2.order_id=p.order_id AND p2.status='reconciliation_required') THEN UPDATE hms.payment_orders SET status=CASE WHEN EXISTS(SELECT 1 FROM hms.payments p2 WHERE p2.order_id=p.order_id AND p2.status='captured') THEN 'paid' ELSE 'expired' END WHERE id=p.order_id; END IF;
 END IF;
 INSERT INTO hms.audit_logs(organization_id,branch_id,action,resource_type,resource_id,result) VALUES(a.organization_id,a.branch_id,'refund.'||p_status,'refund',r.id,'success');
END; $$;
REVOKE ALL ON FUNCTION public.hms_staff_cancel(uuid),public.hms_refund_candidates(uuid,uuid),public.hms_refund_claim(uuid,text),public.hms_refund_access(uuid),public.hms_apply_refund(uuid,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hms_staff_cancel(uuid),public.hms_refund_candidates(uuid,uuid),public.hms_refund_claim(uuid,text),public.hms_refund_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hms_apply_refund(uuid,text,text,bigint,text) TO service_role;
COMMIT;
