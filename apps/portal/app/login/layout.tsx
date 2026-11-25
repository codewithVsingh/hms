import type { Metadata } from 'next';
import { PortalPWA } from '../../components/pwa';
import { pwaMetadata } from '../../lib/pwa';
export const metadata: Metadata = pwaMetadata;
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PortalPWA />
      {children}
    </>
  );
}
