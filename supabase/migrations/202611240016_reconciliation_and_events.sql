BEGIN;
-- Read-only provider reconciliation candidates. No new charges/refunds are initiated by the worker.
CREATE FUNCTION public.hms_v3_reconciliation_candidates(p_slug text,p_branch text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('orders',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT po.provider_order_id "orderId" FROM hms.payment_orders po JOIN hms.invoices i ON i.id=po.invoice_id JOIN hms.branches b ON b.id=i.branch_id JOIN hms.organizations o ON o.id=i.organization_id WHERE o.slug=p_slug AND b.code=p_branch AND po.status IN ('created','reconciliation_required') AND po.created_at>now()-interval '7 days' AND NOT EXISTS(SELECT 1 FROM hms.payments p WHERE p.order_id=po.id AND p.status IN ('captured','reconciliation_required','refunded')) ORDER BY po.created_at DESC LIMIT 10) q),'[]'::jsonb),
 'refunds',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT r.id "refundId",p.provider_payment_id "paymentId",r.amount_paise amount,r.provider_refund_id "providerRefundId",'RF-'||replace(r.id::text,'-','') receipt FROM hms.refunds r JOIN hms.payments p ON p.id=r.payment_id JOIN hms.invoices i ON i.id=p.invoice_id JOIN hms.branches b ON b.id=i.branch_id JOIN hms.organizations o ON o.id=i.organization_id WHERE o.slug=p_slug AND b.code=p_branch AND p.method='razorpay' AND r.status IN ('requested','approved','processing') AND r.provider_refund_id IS NOT NULL ORDER BY r.created_at DESC LIMIT 10) q),'[]'::jsonb));
$$;
CREATE FUNCTION hms_private.v3_notify_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE aid uuid;
BEGIN
 IF NEW.status='captured' THEN
  IF TG_OP='UPDATE' AND OLD.status='captured' THEN RETURN NEW; END IF;
  SELECT appointment_id INTO aid FROM hms.invoices WHERE id=NEW.invoice_id;
  PERFORM hms_private.v3_enqueue(aid,'payment_received','payment:'||NEW.id::text,now());
 END IF; RETURN NEW;
END;$$;
CREATE TRIGGER hms_notify_payment AFTER INSERT OR UPDATE OF status ON hms.payments FOR EACH ROW EXECUTE FUNCTION hms_private.v3_notify_payment();
CREATE FUNCTION hms_private.v3_notify_refund() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE aid uuid;
BEGIN
 IF NEW.status='processed' AND OLD.status IS DISTINCT FROM NEW.status THEN
  SELECT i.appointment_id INTO aid FROM hms.invoices i JOIN hms.payments p ON p.invoice_id=i.id WHERE p.id=NEW.payment_id;
  PERFORM hms_private.v3_enqueue(aid,'refund_processed','refund:'||NEW.id::text,now());
 END IF; RETURN NEW;
END;$$;
CREATE TRIGGER hms_notify_refund AFTER UPDATE OF status ON hms.refunds FOR EACH ROW EXECUTE FUNCTION hms_private.v3_notify_refund();
CREATE FUNCTION hms_private.v3_notify_rx() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE aid uuid;
BEGIN
 IF NEW.status='signed' AND NEW.release_to_patient THEN
  SELECT appointment_id INTO aid FROM hms.encounters WHERE id=NEW.encounter_id;
  PERFORM hms_private.v3_enqueue(aid,'record_available','rx:'||NEW.id::text,now());
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER hms_notify_rx AFTER INSERT ON hms.prescriptions FOR EACH ROW EXECUTE FUNCTION hms_private.v3_notify_rx();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hms_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hms_v3_reconciliation_candidates(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hms_v3_reconciliation_candidates(text,text) TO service_role;
COMMIT;
