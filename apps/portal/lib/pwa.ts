import type { Metadata } from 'next';
// The PWA is limited to the sign-in page and the signed-in staff workspaces.
// Public/booking/cancellation/recovery pages and /patient stay plain web pages.
// Keep the service worker allowlist in public/sw.js in sync with this list.
export const pwaRoles = ['doctor', 'staff', 'admin'] as const;
export const isPwaRole = (role: string) => (pwaRoles as readonly string[]).includes(role);
export const pwaMetadata: Metadata = {
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'HMS' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};
