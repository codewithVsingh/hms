import { ExtendedWorkspace } from '../../../features/live/extended';
import { extraSection } from '../../../lib/extended-nav';
import { LiveWorkspace } from '../../../features/live/workspace';
import { staffContext, sessionClient } from '../../../lib/server/supabase';
import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';
import { Workspace } from '../../../features/workspace';
import { demoEnabled, websiteUrl } from '../../../lib/config';
import { roleNav } from '../../../lib/demo';
import type { Role } from '@hms/types';
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ role: string; section?: string[] }>;
}) {
  const p = await params;
  const role = p.role as Role;
  if (!['doctor', 'staff', 'admin'].includes(role)) notFound();
  const section = p.section?.[0] || 'dashboard';
  if (
    (p.section?.length || 0) > 1 ||
    (demoEnabled &&
      !extraSection(section) &&
      !roleNav[role].some((g) => g.items.some((i) => i.id === section)))
  )
    notFound();
  if (!demoEnabled) {
    let ctx;
    try {
      ctx = await staffContext(await sessionClient());
    } catch {
      redirect('/login');
    }
    const hasRole =
      role === 'admin'
        ? ctx.roles.includes('super_admin')
        : role === 'doctor'
          ? ctx.roles.includes('doctor')
          : ctx.roles.some((r) => ['receptionist', 'billing', 'nurse', 'content_manager'].includes(r));
    if (!hasRole) redirect('/login');
    if (extraSection(section)) return <ExtendedWorkspace role={role} section={section} context={ctx} />;
    return (
      <LiveWorkspace
        key={`${role}/${section}`}
        context={ctx}
        role={role}
        section={section}
        websiteUrl={websiteUrl}
      />
    );
  }
  if (extraSection(section)) return <ExtendedWorkspace role={role} section={section} demo />;
  return <Workspace key={`${role}/${section}`} role={role} section={section} websiteUrl={websiteUrl} />;
}
