import type { Metadata } from 'next';
import { PortalPWA } from '../../components/pwa';
import { isPwaRole, pwaMetadata } from '../../lib/pwa';
// /[role] also matches unknown paths (which render not-found), so only real workspace roles get the PWA.
export async function generateMetadata({ params }: { params: Promise<{ role: string }> }): Promise<Metadata> {
  return isPwaRole((await params).role) ? pwaMetadata : {};
}
export default async function RoleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ role: string }>;
}) {
  const pwa = isPwaRole((await params).role);
  return (
    <>
      {pwa && <PortalPWA />}
      {children}
    </>
  );
}
