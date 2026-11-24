BEGIN;
-- Only the trusted server can create and settle gateway orders. Authenticated users cannot call these RPCs.
CREATE FUNCTION public.hms_claim_order(p_user uuid,p_appointment uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a hms.appointments%ROWTYPE; i hms.invoices%ROWTYPE; o hms.payment_orders%ROWTYPE; claim uuid;
BEGIN
 SELECT * INTO a FROM hms.appointments WHERE id=p_appointment AND booking_user_id=p_user AND source='online';
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM 1 FROM hms.appointment_slots WHERE id=a.slot_id FOR UPDATE;
 SELECT * INTO a FROM hms.appointments WHERE id=p_appointment FOR UPDATE;
 IF a.status<>'held' OR a.hold_expires_at<=now() OR a.payment_choice<>'online' THEN RAISE EXCEPTION 'HOLD_EXPIRED_OR_NOT_PAYABLE'; END IF;
 SELECT * INTO i FROM hms.invoices WHERE appointment_id=a.id FOR UPDATE;
 SELECT * INTO o FROM hms.payment_orders WHERE invoice_id=i.id;
 IF o.id IS NOT NULL THEN RETURN jsonb_build_object('state','existing','orderId',o.provider_order_id,'amount',o.amount_paise,'invoiceId',i.id); END IF;
 IF i.order_claim IS NOT NULL THEN RETURN jsonb_build_object('state','review'); END IF;
 claim:=gen_random_uuid();
 UPDATE hms.invoices SET order_claim=claim,order_claimed_at=now() WHERE id=i.id;
 RETURN jsonb_build_object('state','create','claim',claim,'amount',i.total_paise,'invoiceId',i.id,'receipt','HMS-'||replace(i.id::text,'-',''));
END; $$;
CREATE FUNCTION public.hms_attach_order(p_invoice uuid,p_claim uuid,p_order text,p_amount bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i hms.invoices%ROWTYPE;
BEGIN
 SELECT * INTO i FROM hms.invoices WHERE id=p_invoice AND order_claim=p_claim FOR UPDATE;
 IF NOT FOUND OR i.total_paise<>p_amount OR p_amount<=0 OR p_order !~ '^order_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'ORDER_MISMATCH'; END IF;
 INSERT INTO hms.payment_orders(organization_id,invoice_id,provider_order_id,amount_paise,idempotency_key) VALUES(i.organization_id,i.id,p_order,p_amount,p_claim::text)
 ON CONFLICT(organization_id,invoice_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM hms.payment_orders WHERE invoice_id=i.id AND provider_order_id=p_order AND amount_paise=p_amount) THEN RAISE EXCEPTION 'ORDER_MISMATCH'; END IF;
END; $$;
CREATE FUNCTION public.hms_lookup_order(p_order text,p_user uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('orderId',po.provider_order_id,'amount',po.amount_paise,'appointmentId',a.id,'status',po.status) FROM hms.payment_orders po JOIN hms.invoices i ON i.id=po.invoice_id JOIN hms.appointments a ON a.id=i.appointment_id WHERE po.provider_order_id=p_order AND (p_user IS NULL OR (a.booking_user_id=p_user AND a.source='online'));
$$;
CREATE FUNCTION public.hms_capture_payment(p_order text,p_payment text,p_amount bigint,p_currency text,p_event text,p_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE po hms.payment_orders%ROWTYPE; i hms.invoices%ROWTYPE; a hms.appointments%ROWTYPE; pid uuid; final_state text; existing hms.payments%ROWTYPE;
BEGIN
 SELECT * INTO po FROM hms.payment_orders WHERE provider_order_id=p_order;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
 SELECT * INTO i FROM hms.invoices WHERE id=po.invoice_id;
 SELECT * INTO a FROM hms.appointments WHERE id=i.appointment_id;
 -- Always lock slot, appointment, invoice, order in that order. Captures and reservations serialize.
 PERFORM 1 FROM hms.appointment_slots WHERE id=a.slot_id FOR UPDATE;
 SELECT * INTO a FROM hms.appointments WHERE id=a.id FOR UPDATE;
 SELECT * INTO i FROM hms.invoices WHERE id=i.id FOR UPDATE;
 SELECT * INTO po FROM hms.payment_orders WHERE id=po.id FOR UPDATE;
 IF p_currency<>'INR' OR po.amount_paise<>p_amount OR p_amount<=0 OR p_payment !~ '^pay_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'PAYMENT_MISMATCH'; END IF;
 IF p_event IS NOT NULL THEN
 INSERT INTO hms.webhook_events(provider,provider_event_id,event_type,payload_digest) VALUES('razorpay',p_event,'payment.captured',p_digest) ON CONFLICT(provider,provider_event_id) DO NOTHING;
 END IF;
 SELECT * INTO existing FROM hms.payments WHERE provider_payment_id=p_payment;
 IF existing.id IS NOT NULL THEN
 IF existing.order_id<>po.id OR existing.amount_paise<>p_amount THEN RAISE EXCEPTION 'PAYMENT_MISMATCH'; END IF;
 ELSE
 IF a.status='held' AND a.hold_expires_at>now() AND EXISTS(SELECT 1 FROM hms.appointment_slots s WHERE s.id=a.slot_id AND s.enabled AND s.starts_at>now()) AND NOT EXISTS(SELECT 1 FROM hms.doctor_leaves l JOIN hms.appointment_slots s ON s.id=a.slot_id WHERE l.organization_id=a.organization_id AND l.doctor_id=a.doctor_id AND tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(s.starts_at,s.ends_at,'[)')) AND i.status='issued' AND po.status='created' THEN
 final_state:='captured';
 UPDATE hms.appointments SET status='confirmed',updated_at=now() WHERE id=a.id;
 INSERT INTO hms.appointment_status_history(organization_id,appointment_id,from_status,to_status,reason_code) VALUES(a.organization_id,a.id,'held','confirmed','payment_captured');
 UPDATE hms.invoices SET status='settled' WHERE id=i.id;
 UPDATE hms.payment_orders SET status='paid' WHERE id=po.id;
 PERFORM hms_private.confirm_care(a.id);
 ELSE
 final_state:='reconciliation_required';
 UPDATE hms.payment_orders SET status='reconciliation_required' WHERE id=po.id;
 IF a.status='held' AND a.hold_expires_at<=now() THEN PERFORM hms_private.expire_slot_holds(a.organization_id,a.slot_id); END IF;
 END IF;
 INSERT INTO hms.payments(organization_id,invoice_id,order_id,method,provider_payment_id,amount_paise,status,captured_at) VALUES(a.organization_id,i.id,po.id,'razorpay',p_payment,p_amount,final_state,now()) RETURNING id INTO pid;
 INSERT INTO hms.audit_logs(organization_id,branch_id,action,resource_type,resource_id,result) VALUES(a.organization_id,a.branch_id,CASE WHEN final_state='captured' THEN 'payment.capture' ELSE 'payment.review_required' END,'payment',pid,'success');
 END IF;
 IF p_event IS NOT NULL THEN UPDATE hms.webhook_events SET state='processed',processed_at=now() WHERE provider='razorpay' AND provider_event_id=p_event; END IF;
 RETURN hms_private.booking_view(a.id);
END; $$;
REVOKE ALL ON FUNCTION public.hms_claim_order(uuid,uuid),public.hms_attach_order(uuid,uuid,text,bigint),public.hms_lookup_order(text,uuid),public.hms_capture_payment(text,text,bigint,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hms_claim_order(uuid,uuid),public.hms_attach_order(uuid,uuid,text,bigint),public.hms_lookup_order(text,uuid),public.hms_capture_payment(text,text,bigint,text,text,text) TO service_role;
COMMIT;
