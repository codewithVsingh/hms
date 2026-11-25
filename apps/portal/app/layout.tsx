import { LanguageSwitch, L } from '@hms/ui';
import type { Metadata, Viewport } from 'next';
import '@hms/ui/styles.css';
import './portal.css';
export const metadata: Metadata = {
  title: { default: 'Hospital Management System', template: '%s | Aarogya HMS' },
  description: 'Secure hospital operations and patient services.',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: '#096b66', width: 'device-width', initialScale: 1 };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <div className="portal-language-bar">
          <small>
            <L en="Language" hi="भाषा" />
          </small>
          <LanguageSwitch />
        </div>
        {children}
      </body>
    </html>
  );
}
