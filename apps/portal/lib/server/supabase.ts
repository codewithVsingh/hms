import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
export function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error('CONFIGURATION_REQUIRED');
  return value;
}
export function scope() {
  return { p_slug: env('HMS_ORGANIZATION_SLUG'), p_branch: env('HMS_BRANCH_CODE') };
}
export async function sessionClient() {
  const store = await cookies();
  return createServerClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: 'lax',
              secure: process.env.NODE_ENV === 'production',
            }),
          );
        } catch {
          /* Read-only server component: proxy refreshes session. */
        }
      },
    },
  });
}
export function serviceClient() {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
export async function rpc<T = unknown>(
  client: Awaited<ReturnType<typeof sessionClient>> | ReturnType<typeof serviceClient>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function currentUser(client: Awaited<ReturnType<typeof sessionClient>>) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('AUTH_REQUIRED');
  return data.user;
}
export type StaffContext = {
  organizationId: string;
  branchId: string;
  name: string;
  roles: string[];
  permissions: string[];
};
export async function staffContext(client: Awaited<ReturnType<typeof sessionClient>>) {
  await currentUser(client);
  const ctx = await rpc<StaffContext | null>(client, 'hms_staff_context', scope());
  if (!ctx) throw new Error('FORBIDDEN');
  return ctx;
}
