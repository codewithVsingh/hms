import { LanguageSwitch, L } from '@hms/ui';
import { PortalPWA } from '../components/pwa';
import type { Metadata, Viewport } from 'next';
import '@hms/ui/styles.css';
import './portal.css';
export const metadata: Metadata = {
  title: { default: 'Hospital Management System', template: '%s | Aarogya HMS' },
  description: 'Secure hospital operations and patient services.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'HMS' },
  icons: { apple: '/icons/apple-touch-icon.png' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: '#096b66', width: 'device-width', initialScale: 1 };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <a href="#main" className="skip-link">
          <L en={'Skip to content'} />
        </a>
        <div className="portal-language-bar">
          <small>
            <L en="Language" hi="भाषा" />
          </small>
          <LanguageSwitch />
        </div>
        <PortalPWA />
        {children}
      </body>
    </html>
  );
}
