import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  currentUser,
  sessionClient,
  serviceClient,
  staffContext,
  rpc,
  scope,
  env,
} from '../../../../lib/server/supabase';
import { tryPolicyRefund } from '../../../../lib/server/policy-refunds';
import { demoEnabled } from '../../../../lib/config';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const id = z.string().uuid(),
  mrn = z.string().trim().min(3).max(40),
  money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const out = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
const errors: Record<string, [number, string]> = {
  AUTH_REQUIRED: [401, 'Verify your mobile or sign in.'],
  FORBIDDEN: [403, 'Access denied.'],
  INVALID_REQUEST: [400, 'Check submitted details.'],
  POLICY_CHANGED: [409, 'Cancellation policy changed. Reload and review it.'],
  QUOTE_CHANGED: [409, 'The booking or refund quote changed. Review the current amount.'],
  NOT_CANCELLABLE: [409, 'This booking needs reception review before cancellation.'],
  INVALID_STATUS: [409, 'This operation is not available for the current visit.'],
  CONFIGURATION_REQUIRED: [503, 'Service is not configured.'],
  SCAN_FAILED: [422, 'File did not pass security scanning.'],
  NOT_CURRENT_VERSION: [
    409,
    'This prescription has already been replaced or withdrawn. Reload to see the current version.',
  ],
  WITHDRAWAL_PENDING: [409, 'A withdrawal request is pending for this prescription.'],
  AMEND_WINDOW_CLOSED: [409, 'The amendment window has closed. Write a new prescription instead.'],
  SECOND_PERSON_REQUIRED: [409, 'A second person must confirm this. You cannot approve your own request.'],
  BOTH_HAVE_ACCOUNTS: [
    409,
    'Both records have their own online account, so they are treated as two people and cannot be merged.',
  ],
  MERGE_PENDING: [409, 'A merge involving one of these patients is already waiting for approval.'],
  ID_CHECK_REQUIRED: [400, 'Record which identity document you checked before approving the merge.'],
  UNDO_WINDOW_CLOSED: [409, 'The undo period for this merge has ended.'],
  UNDO_BLOCKED: [409, 'A later merge involves one of these patients. Undo that merge first.'],
};
function fail(e: unknown) {
  if (e instanceof z.ZodError)
    return out({ error: 'Check submitted details.', code: 'INVALID_REQUEST' }, 400);
  const key = e instanceof Error ? e.message : '';
  const v = errors[key] || [500, 'Operation unavailable. Contact reception.'];
  return out({ error: v[1], code: errors[key] ? key : 'UNAVAILABLE' }, v[0]);
}
function checkOrigin(req: NextRequest) {
  if (req.headers.get('origin') !== new URL(env('NEXT_PUBLIC_PORTAL_URL')).origin)
    throw new Error('FORBIDDEN');
}
export async function GET(req: NextRequest, { params }: { params: Promise<{ action: string[] }> }) {
  try {
    if (demoEnabled) return out({ error: 'Live API disabled in preview' }, 503);
    const path = (await params).action.join('/'),
      c = await sessionClient(),
      q = req.nextUrl.searchParams;
    if (path === 'policy') return out(await rpc(c, 'hms_v4_policy', scope()));
    await currentUser(c);
    if (path === 'cancel/quote')
      return out(await rpc(c, 'hms_v4_cancel_quote', { p_id: id.parse(q.get('id')) }));
    if (path === 'prescription/history')
      return out(await rpc(c, 'hms_v6_rx_history', { p_rx: id.parse(q.get('id')) }));
    if (path === 'patients/duplicates') {
      const ctx = await staffContext(c);
      return out(await rpc(c, 'hms_v7_duplicates', { p_org: ctx.organizationId, p_branch: ctx.branchId }));
    }
    if (path === 'patients/merges') {
      const ctx = await staffContext(c);
      return out(await rpc(c, 'hms_v7_merges', { p_org: ctx.organizationId, p_branch: ctx.branchId }));
    }
    if (path === 'prescription/withdrawals') {
      const ctx = await staffContext(c);
      return out(
        await rpc(c, 'hms_v6_rx_withdrawals', { p_org: ctx.organizationId, p_branch: ctx.branchId }),
      );
    }
    return out({ error: 'Not found' }, 404);
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string[] }> }) {
  try {
    if (demoEnabled) return out({ error: 'Live API disabled in preview' }, 503);
    checkOrigin(req);
    const path = (await params).action.join('/'),
      c = await sessionClient(),
      user = await currentUser(c);
    if (path === 'prescription/paper') {
      const size = Number(req.headers.get('content-length'));
      if (!size || size > 4.3 * 1024 * 1024) return out({ error: 'File too large' }, 413);
      const form = await req.formData(),
        appointment = id.parse(form.get('appointment')),
        file = form.get('file');
      if (!(file instanceof File) || file.size < 1 || file.size > 4 * 1024 * 1024)
        throw new Error('INVALID_REQUEST');
      const access = await rpc<{ org: string; patient: string; actor: string }>(c, 'hms_v4_paper_scope', {
        p_id: appointment,
      });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const valid =
        (file.type === 'application/pdf' && Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-') ||
        (file.type === 'image/png' &&
          Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (file.type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255);
      if (!valid) throw new Error('INVALID_REQUEST');
      const scanner = new URL(env('HMS_PRIVATE_SCANNER_URL'));
      if (scanner.protocol !== 'https:') throw new Error('CONFIGURATION_REQUIRED');
      const scan = await fetch(scanner, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env('HMS_PRIVATE_SCANNER_TOKEN'),
          'Content-Type': 'application/octet-stream',
        },
        body: bytes,
        signal: AbortSignal.timeout(20000),
      });
      if (!scan.ok || (await scan.json()).clean !== true) throw new Error('SCAN_FAILED');
      const storagePath = `${access.org}/${access.patient}/${crypto.randomUUID()}`,
        service = serviceClient(),
        bucket = service.storage.from('hms-private-documents'),
        upload = await bucket.upload(storagePath, bytes, {
          contentType: file.type,
          upsert: false,
          cacheControl: '0',
        });
      if (upload.error) throw new Error('UPLOAD_FAILED');
      try {
        return out({
          id: await rpc(service, 'hms_v4_paper_add', {
            p_appointment: appointment,
            p_actor: user.id,
            p_path: storagePath,
            p_mime: file.type,
            p_bytes: file.size,
            p_name: file.name.slice(0, 180),
          }),
        });
      } catch (e) {
        await bucket.remove([storagePath]);
        throw e;
      }
    }
    const raw = await req.text();
    if (raw.length > 60000) throw new Error('INVALID_REQUEST');
    let b: unknown;
    try {
      b = JSON.parse(raw);
    } catch {
      throw new Error('INVALID_REQUEST');
    }
    if (path === 'booking/find') {
      const x = z
        .object({ reference: z.string().trim().min(4).max(40), identity: z.string().trim().min(2).max(100) })
        .parse(b);
      return out(
        await rpc(c, 'hms_v4_find_booking', { ...scope(), p_reference: x.reference, p_identity: x.identity }),
      );
    }
    if (path === 'cancel/confirm') {
      const x = z
        .object({
          id,
          paidPaise: money,
          deductionPaise: money,
          refundPaise: money,
          policyVersion: z.number().int().min(0),
          slotId: id,
        })
        .parse(b);
      const result = await rpc<{ refundId: string | null }>(c, 'hms_v4_cancel', {
        p_id: x.id,
        p_paid: x.paidPaise,
        p_deduction: x.deductionPaise,
        p_refund: x.refundPaise,
        p_policy: x.policyVersion,
        p_slot: x.slotId,
      });
      // Cancellation is already committed. Provider failures do not undo it or trigger blind retries.
      if (result.refundId && process.env.HMS_AUTO_POLICY_REFUNDS === 'true') {
        try {
          await tryPolicyRefund(result.refundId);
        } catch {
          /* Pending/processing remains visible for review. */
        }
      }
      return out(await rpc(c, 'hms_v4_cancel_quote', { p_id: x.id }));
    }
    const ctx = await staffContext(c),
      args = { p_org: ctx.organizationId, p_branch: ctx.branchId };
    // Duplicate patients and merges (migration 023; rules in docs/BUSINESS_RULES.md section 10).
    if (path === 'patients/duplicates/check') {
      const x = z.object({ patientId: id }).parse(b);
      return out(await rpc(c, 'hms_v7_patient_candidates', { ...args, p_patient: x.patientId }));
    }
    if (path === 'patients/duplicates/dismiss') {
      const x = z.object({ id, note: z.string().trim().min(5).max(300) }).parse(b);
      return out(await rpc(c, 'hms_v7_flag_dismiss', { p_flag: x.id, p_note: x.note }));
    }
    if (path === 'patients/merges') {
      const x = z.object({ a: id, b: id, note: z.string().max(500).nullable() }).parse(b);
      return out(await rpc(c, 'hms_v7_merge_propose', { ...args, p_a: x.a, p_b: x.b, p_note: x.note }));
    }
    if (path === 'patients/merges/cancel') {
      const x = z.object({ id }).parse(b);
      return out(await rpc(c, 'hms_v7_merge_cancel', { p_merge: x.id }));
    }
    if (path === 'patients/merges/decide') {
      const choice = z.enum(['survivor', 'merged']);
      const x = z
        .object({
          id,
          approve: z.boolean(),
          idCheck: z
            .enum(['aadhaar', 'pan', 'passport', 'driving_licence', 'voter_id', 'other_government_id'])
            .nullable(),
          choices: z.object({ name: choice, birthDate: choice, gender: choice }).partial().nullable(),
          note: z.string().max(500).nullable(),
        })
        .parse(b);
      return out(
        await rpc(c, 'hms_v7_merge_decide', {
          p_merge: x.id,
          p_approve: x.approve,
          p_id_check: x.idCheck,
          p_choices: x.choices,
          p_note: x.note,
        }),
      );
    }
    if (path === 'patients/merges/undo') {
      const x = z.object({ id, note: z.string().trim().min(5).max(500) }).parse(b);
      return out(await rpc(c, 'hms_v7_merge_undo', { p_merge: x.id, p_note: x.note }));
    }
    // Prescription corrections (migration 022; rules in docs/BUSINESS_RULES.md section 7).
    if (path === 'prescription/amend') {
      const item = z.object({
        medicine: z.string().trim().min(1).max(180),
        dose: z.string().trim().min(1).max(100),
        frequency: z.string().trim().min(1).max(100),
        duration: z.string().trim().min(1).max(100),
        instructions: z.string().max(500),
      });
      const x = z
        .object({
          id,
          items: z.array(item).min(1).max(25),
          followUp: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable(),
          reason: z.enum(['typo', 'dose_change', 'wrong_medicine', 'instructions', 'follow_up', 'other']),
          note: z.string().max(500).nullable(),
          attest: z.literal(true),
        })
        .parse(b);
      return out(
        await rpc(c, 'hms_v6_rx_amend', {
          p_rx: x.id,
          p_items: x.items,
          p_follow: x.followUp,
          p_reason: x.reason,
          p_note: x.note,
          p_attest: x.attest,
        }),
      );
    }
    if (path === 'prescription/withdraw') {
      const x = z
        .object({
          id,
          reason: z.enum(['wrong_patient', 'issued_in_error', 'duplicate', 'other']),
          note: z.string().max(500).nullable(),
        })
        .parse(b);
      return out(
        await rpc(c, 'hms_v6_rx_withdraw_request', { p_rx: x.id, p_reason: x.reason, p_note: x.note }),
      );
    }
    if (path === 'prescription/withdraw/cancel') {
      const x = z.object({ id }).parse(b);
      return out(await rpc(c, 'hms_v6_rx_withdraw_cancel', { p_withdrawal: x.id }));
    }
    if (path === 'prescription/withdraw/decide') {
      const x = z.object({ id, approve: z.boolean(), note: z.string().max(500).nullable() }).parse(b);
      return out(
        await rpc(c, 'hms_v6_rx_withdraw_decide', {
          p_withdrawal: x.id,
          p_approve: x.approve,
          p_note: x.note,
        }),
      );
    }
    if (path === 'prescription/recall') {
      const x = z.object({ id }).parse(b);
      return out(await rpc(c, 'hms_v6_rx_recall_ack', { p_rx: x.id }));
    }
    if (path === 'timeline') {
      const x = z.object({ mrn, offset: z.number().int().min(0).max(100000) }).parse(b);
      return out(await rpc(c, 'hms_v4_patient_timeline', { ...args, p_mrn: x.mrn, p_offset: x.offset }));
    }
    if (path === 'prescription-register') {
      const x = z.object({ mrn }).parse(b);
      return out(await rpc(c, 'hms_v4_rx_register', { ...args, p_mrn: x.mrn }));
    }
    if (path === 'policy') {
      const x = z
        .object({
          feePaise: money.max(10000000),
          freeHours: z.number().int().min(0).max(720),
          version: z.number().int().min(1),
        })
        .parse(b);
      return out(
        await rpc(c, 'hms_v4_policy_set', {
          ...args,
          p_fee: x.feePaise,
          p_hours: x.freeHours,
          p_expected: x.version,
        }),
      );
    }
    if (path === 'prescription/handover') {
      const x = z.object({ id, method: z.enum(['printed', 'patient_portal', 'paper_copy']) }).parse(b);
      return out(await rpc(c, 'hms_v4_rx_handover', { p_id: x.id, p_method: x.method }));
    }
    if (path === 'prescription/verify') {
      const x = z.object({ id }).parse(b);
      return out(await rpc(c, 'hms_v4_paper_verify', { p_id: x.id }));
    }
    return out({ error: 'Not found' }, 404);
  } catch (e) {
    return fail(e);
  }
}
