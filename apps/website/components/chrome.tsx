import { publicLive, hospitalName, hospitalAddress, hospitalPhone, hospitalHours } from '../lib/live';
import { Brand, Button, Icon, L, LanguageSwitch, LanguageLink } from '@hms/ui';
import { portalUrl } from '../lib/config';
const nav = [
  ['Home', '/'],
  ['About', '/about'],
  ['Doctors', '/doctors'],
  ['Specialties', '/services'],
  ['Health library', '/health-library'],
  ['Contact', '/contact'],
];
export function WebsiteHeader() {
  return (
    <>
      <div className="utility">
        <div className="site-container utility-inner">
          <span>
            <span className="live-dot" />{' '}
            {publicLive
              ? hospitalHours || 'Hospital information & appointments'
              : 'Healthcare website preview • fictional information'}
          </span>
          <span className="utility-links">
            <LanguageLink href={`${portalUrl}/manage-booking`}>
              <L en="Manage booking" />
            </LanguageLink>{' '}
            ·{' '}
            <a href="/request-callback">
              <L en="Request callback" />
            </a>{' '}
            ·{' '}
            <LanguageLink href={`${portalUrl}/login`}>
              <Icon name="lock" size={13} /> <L en="Staff login" />
            </LanguageLink>
          </span>
        </div>
      </div>
      <header className="site-header">
        <div className="site-container nav-inner">
          <Brand name={publicLive ? hospitalName : undefined} />
          <nav aria-label="Main navigation" className="desktop-nav">
            {nav.map(([label, href]) => (
              <a key={href} href={href}>
                <L en={label} />
              </a>
            ))}
          </nav>
          <div className="nav-actions">
            <LanguageSwitch />
            <Button href={`${portalUrl}/book`} icon="calendar">
              Book appointment
            </Button>
            <details className="mobile-menu">
              <summary aria-label="Open navigation">
                <Icon name="menu" size={24} />
              </summary>
              <nav aria-label="Mobile navigation">
                {nav.map(([label, href]) => (
                  <a key={href} href={href}>
                    <L en={label} />
                  </a>
                ))}
                <LanguageLink href={`${portalUrl}/login`}>
                  <L en="Staff login" />
                </LanguageLink>
                <LanguageLink href={`${portalUrl}/manage-booking`}>
                  <L en="Manage booking" />
                </LanguageLink>
                <Button href={`${portalUrl}/book`}>Book appointment</Button>
              </nav>
            </details>
          </div>
        </div>
      </header>
    </>
  );
}
export function WebsiteFooter() {
  return (
    <footer className="footer">
      <div className="site-container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Brand
              name={publicLive ? hospitalName : undefined}
              sub={publicLive ? 'Patient services' : 'A hospital website demo'}
            />
            <p>
              {publicLive
                ? hospitalAddress || 'Contact reception for information.'
                : 'Designed for a simpler, more connected patient journey. All names and service information are fictional placeholders.'}
            </p>
            {publicLive && hospitalPhone && (
              <a href={`tel:${hospitalPhone.replace(/[^+\d]/g, '')}`}>{hospitalPhone}</a>
            )}
            <span className="footer-label">
              <Icon name="shield" size={16} /> Privacy-first design
            </span>
          </div>
          <div>
            <h3>
              <L en="Explore" />
            </h3>
            {nav.slice(1).map(([label, href]) => (
              <a key={href} href={href}>
                <L en={label} />
              </a>
            ))}
          </div>
          <div>
            <h3>
              <L en="Patient services" />
            </h3>
            <LanguageLink href={`${portalUrl}/manage-booking`}>
              <L en="Manage booking" />
            </LanguageLink>
            <LanguageLink href={`${portalUrl}/book`}>
              <L en="Book appointment" />
            </LanguageLink>
            <a href={publicLive ? `${portalUrl}/my-bookings` : '/health-library/booking-guide'}>
              {publicLive ? 'My appointments' : 'Booking guide'}
            </a>
            <a href="/request-callback">
              <L en="Request a callback" />
            </a>
            <a href="/policies/privacy">
              <L en="Privacy notice" />
            </a>
            <a href="/policies/booking">
              <L en="Booking & cancellation" />
            </a>
            <a href="/policies/refund">
              <L en="Refund policy" />
            </a>
          </div>
          <div>
            <h3>
              <L en="Hospital operations" />
            </h3>
            <p>Doctor, staff and administration workspace.</p>
            <Button href={`${portalUrl}/login`} variant="secondary" icon="lock">
              Open HMS portal
            </Button>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} {publicLive ? hospitalName : 'Aarogya Care • Demo'}
          </span>
          <span>
            {publicLive
              ? 'For emergencies, contact local emergency services.'
              : 'Not a live healthcare provider. For emergencies, contact local emergency services.'}
          </span>
        </div>
      </div>
    </footer>
  );
}
