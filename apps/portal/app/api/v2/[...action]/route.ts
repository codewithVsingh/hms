import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  sessionClient,
  serviceClient,
  staffContext,
  currentUser,
  rpc,
  scope,
  env,
} from '../../../../lib/server/supabase';
import { demoEnabled } from '../../../../lib/config';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const out = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
const id = z.string().uuid(),
  day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  role = z.enum(['doctor', 'receptionist', 'billing', 'nurse', 'content_manager', 'super_admin']);
const errs: Record<string, string> = {
  FORBIDDEN: 'Access denied.',
  AUTH_REQUIRED: 'Sign in again.',
  INVALID_REQUEST: 'Check the submitted fields.',
  SLOT_UNAVAILABLE: 'That time is no longer available.',
  INVALID_STATUS: 'This operation is not allowed for the current visit or payment status.',
  SIGNED_RECORD: 'Issued records cannot be overwritten.',
  REGISTRATION_REQUIRED: 'Doctor registration number is required.',
  LEAVE_HAS_BOOKINGS: 'Move or cancel affected bookings before adding leave.',
  BOOKING_DISABLED: 'Online booking is closed.',
  CONTACT_NOT_VERIFIED: 'Verify this contact first.',
  DOCTOR_PROFILE_REQUIRED: 'Provision a doctor profile and branch first.',
  EXISTING_MEMBERSHIP: 'The identity already belongs to a team; review it manually.',
  CONFIGURATION_REQUIRED: 'This integration is not configured.',
};
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : '';
  return out(
    {
      error:
        e instanceof z.ZodError
          ? 'Check submitted details.'
          : errs[msg] || 'The operation could not be completed. Contact reception if it persists.',
    },
    e instanceof z.ZodError
      ? 400
      : msg === 'AUTH_REQUIRED'
        ? 401
        : msg === 'FORBIDDEN'
          ? 403
          : msg === 'CONFIGURATION_REQUIRED'
            ? 503
            : errs[msg]
              ? 409
              : 500,
  );
}
function origin(req: NextRequest) {
  if (req.headers.get('origin') !== new URL(env('NEXT_PUBLIC_PORTAL_URL')).origin)
    throw new Error('FORBIDDEN');
}
export async function GET(req: NextRequest, { params }: { params: Promise<{ action: string[] }> }) {
  try {
    if (demoEnabled) return out({ error: 'Live API disabled in preview' }, 503);
    const path = (await params).action.join('/'),
      q = req.nextUrl.searchParams,
      c = await sessionClient();
    await currentUser(c);
    if (path === 'patient/records')
      return out(await rpc(c, 'hms_v3_patient_records', { p_slug: scope().p_slug }));
    if (path === 'patient/preferences')
      return out(await rpc(c, 'hms_v3_preferences', { p_slug: scope().p_slug }));
    if (path === 'move-slots')
      return out(
        await rpc(c, 'hms_v3_move_slots', { p_id: id.parse(q.get('id')), p_day: day.parse(q.get('date')) }),
      );
    if (path === 'invoice') return out(await rpc(c, 'hms_v3_invoice', { p_id: id.parse(q.get('id')) }));
    if (path === 'documents')
      return out(
        await rpc(c, 'hms_v3_documents', {
          p_appointment: q.has('appointment') ? id.parse(q.get('appointment')) : null,
          p_slug: scope().p_slug,
        }),
      );
    if (path === 'documents/download') {
      const storagePath = await rpc<string>(c, 'hms_v3_document_access', { p_id: id.parse(q.get('id')) });
      const { data, error } = await serviceClient()
        .storage.from('hms-private-documents')
        .createSignedUrl(storagePath, 60, { download: true });
      if (error || !data) throw new Error('NOT_FOUND');
      return out({ url: data.signedUrl });
    }
    const ctx = await staffContext(c),
      args = { p_org: ctx.organizationId, p_branch: ctx.branchId };
    if (path === 'care') return out(await rpc(c, 'hms_v3_care', { p_id: id.parse(q.get('id')) }));
    if (path === 'queue')
      return out(await rpc(c, 'hms_v3_queue', { ...args, p_day: day.parse(q.get('date')) }));
    if (path === 'leaves') return out(await rpc(c, 'hms_v3_leaves', args));
    if (path === 'reports')
      return out(
        await rpc(c, 'hms_v3_reports', {
          ...args,
          p_from: day.parse(q.get('from')),
          p_to: day.parse(q.get('to')),
        }),
      );
    if (path === 'team') return out(await rpc(c, 'hms_v3_team', args));
    if (path === 'inquiries') return out(await rpc(c, 'hms_v3_inquiries', args));
    if (path === 'notifications') return out(await rpc(c, 'hms_v3_notification_status', args));
    return out({ error: 'Not found' }, 404);
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string[] }> }) {
  try {
    if (demoEnabled) return out({ error: 'Live API disabled in preview' }, 503);
    origin(req);
    const path = (await params).action.join('/'),
      c = await sessionClient();
    if (path === 'auth/recover') {
      const b = z
        .object({ email: z.string().email().max(254), captchaToken: z.string().min(1).max(4096) })
        .parse(await req.json().catch(() => null));
      await c.auth.resetPasswordForEmail(b.email, {
        redirectTo: env('NEXT_PUBLIC_PORTAL_URL') + '/auth/callback?next=/reset-password',
        captchaToken: b.captchaToken,
      });
      return out({ accepted: true });
    }
    const user = await currentUser(c);
    if (path === 'documents/upload') {
      const size = Number(req.headers.get('content-length'));
      if (!size || size > 4.3 * 1024 * 1024) return out({ error: 'File too large' }, 413);
      const form = await req.formData(),
        appointment = id.parse(form.get('appointment')),
        type = z.enum(['report', 'image', 'referral', 'other']).parse(form.get('type')),
        release = form.get('release') === 'true',
        file = form.get('file');
      if (!(file instanceof File) || file.size < 1 || file.size > 4 * 1024 * 1024)
        throw new Error('INVALID_REQUEST');
      const access = await rpc<{
        org: string;
        branch: string;
        patient: string;
        appointment: string;
        actor: string;
      }>(c, 'hms_v3_document_scope', { p_id: appointment, p_write: true });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const magic =
        (file.type === 'application/pdf' && Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-') ||
        (file.type === 'image/png' &&
          Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (file.type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255);
      if (!magic) throw new Error('INVALID_REQUEST');
      // No scanning service = no upload. Scanner must be controlled/approved for medical data and return clean:true.
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
      if (!scan.ok || (await scan.json()).clean !== true)
        return out({ error: 'File did not pass security scanning.' }, 422);
      const storagePath = `${access.org}/${access.patient}/${crypto.randomUUID()}`,
        service = serviceClient(),
        bucket = service.storage.from('hms-private-documents');
      const upload = await bucket.upload(storagePath, bytes, {
        contentType: file.type,
        upsert: false,
        cacheControl: '0',
      });
      if (upload.error) throw new Error('UPLOAD_FAILED');
      try {
        return out({
          id: await rpc(service, 'hms_v3_document_add', {
            p_org: access.org,
            p_branch: access.branch,
            p_patient: access.patient,
            p_appointment: appointment,
            p_actor: access.actor,
            p_path: storagePath,
            p_mime: file.type,
            p_bytes: file.size,
            p_name: file.name.slice(0, 180),
            p_type: type,
            p_release: release,
          }),
        });
      } catch (e) {
        await bucket.remove([storagePath]);
        throw e;
      }
    }
    const raw = await req.text();
    if (raw.length > 100000) throw new Error('INVALID_REQUEST');
    let b;
    try {
      b = JSON.parse(raw);
    } catch {
      throw new Error('INVALID_REQUEST');
    }
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('INVALID_REQUEST');
    if (path === 'auth/password') {
      const password = z.string().min(12).max(200).parse(b.password);
      const { error } = await c.auth.updateUser({ password });
      if (error) throw new Error('INVALID_REQUEST');
      await c.auth.signOut({ scope: 'global' });
      return out({ updated: true });
    }
    if (path === 'reschedule') {
      const x = z.object({ id, slotId: id }).parse(b);
      return out(await rpc(c, 'hms_v3_reschedule', { p_id: x.id, p_slot: x.slotId }));
    }
    if (path === 'patient/preferences') {
      const x = z.object({ channel: z.enum(['email', 'sms', 'whatsapp']), enabled: z.boolean() }).parse(b);
      return out(
        await rpc(c, 'hms_v3_preferences', {
          p_slug: scope().p_slug,
          p_channel: x.channel,
          p_enabled: x.enabled,
        }),
      );
    }
    const ctx = await staffContext(c),
      args = { p_org: ctx.organizationId, p_branch: ctx.branchId };
    if (path === 'inquiries') {
      const x = z.object({ id, state: z.enum(['contacted', 'closed']) }).parse(b);
      return out(await rpc(c, 'hms_v3_inquiries', { ...args, p_id: x.id, p_state: x.state }));
    }
    if (path === 'patient/edit') {
      const x = z
        .object({
          id,
          name: z.string().trim().min(2).max(100),
          birth: day.nullable(),
          gender: z.enum(['female', 'male', 'other', 'not_disclosed']).nullable(),
        })
        .parse(b);
      return out(
        await rpc(c, 'hms_v3_patient_edit', {
          ...args,
          p_id: x.id,
          p_name: x.name,
          p_birth: x.birth,
          p_gender: x.gender,
        }),
      );
    }
    if (path === 'care/record') {
      const x = z
        .object({
          id,
          kind: z.enum(['vitals', 'diagnosis', 'allergy', 'condition', 'history']),
          data: z.record(z.string(), z.union([z.string(), z.number()])),
        })
        .parse(b);
      return out(await rpc(c, 'hms_v3_record', { p_id: x.id, p_kind: x.kind, p_data: x.data }));
    }
    if (path === 'care/prescription') {
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
          followUp: day.nullable(),
          release: z.boolean(),
          attest: z.literal(true),
        })
        .parse(b);
      return out(
        await rpc(c, 'hms_v3_issue_rx', {
          p_id: x.id,
          p_items: x.items,
          p_follow: x.followUp,
          p_release: x.release,
          p_attest: x.attest,
        }),
      );
    }
    if (path === 'leaves') {
      const x = z.object({ doctorId: id, start: z.iso.datetime(), end: z.iso.datetime() }).parse(b);
      return out(
        await rpc(c, 'hms_v3_leave_add', { ...args, p_doctor: x.doctorId, p_start: x.start, p_end: x.end }),
      );
    }
    if (path === 'team/roles') {
      const x = z.object({ member: id, roles: z.array(role).max(6) }).parse(b);
      return out(await rpc(c, 'hms_v3_roles', { ...args, p_member: x.member, p_roles: x.roles }));
    }
    if (path === 'team/invite') {
      if (!ctx.permissions.includes('users.manage')) throw new Error('FORBIDDEN');
      const x = z
        .object({
          name: z.string().trim().min(2).max(100),
          email: z.string().email().max(254),
          role: z.enum(['receptionist', 'billing', 'nurse', 'content_manager']),
        })
        .parse(b);
      const service = serviceClient(),
        result = await service.auth.admin.inviteUserByEmail(x.email, {
          redirectTo: env('NEXT_PUBLIC_PORTAL_URL') + '/auth/callback?next=/reset-password',
        });
      if (result.error || !result.data.user) throw new Error('INVITATION_FAILED');
      return out({
        id: await rpc(service, 'hms_v3_link_invite', {
          ...args,
          p_actor: user.id,
          p_user: result.data.user.id,
          p_name: x.name,
          p_role: x.role,
        }),
      });
    }
    return out({ error: 'Not found' }, 404);
  } catch (e) {
    return fail(e);
  }
}
